import Combine
import Foundation

/// View-facing state. The window observes this; mutations happen on the main actor.
@MainActor
final class SessionController: ObservableObject {
    enum Status: Equatable {
        case idle
        case starting
        case live
        case error(String)
        case ended
    }

    @Published private(set) var status: Status = .idle
    @Published private(set) var meetingId: String?
    @Published private(set) var sessionId: String?
    @Published private(set) var latestSuggestion: Suggestion?
    @Published private(set) var lastCustomerText: String?
    @Published private(set) var rollingTurns: [(speaker: String, text: String)] = []
    @Published var isPaused = false
    /// When true, also captures system audio via ScreenCaptureKit and mixes it
    /// with the mic. Off by default — first launch should explain the screen
    /// recording permission prompt before flipping this.
    @Published var captureSystemAudio: Bool = false
    @Published private(set) var systemAudioActive: Bool = false
    @Published private(set) var recap: RecapPayload?
    @Published private(set) var notifications: [InboxNotification] = []
    @Published private(set) var scriptStages: [ScriptStage] = []
    @Published private(set) var currentStage: String = "discovery"
    @Published var checklistMode: Bool = false

    private var client: AthenaClient?
    private var settings: Settings?
    private var session: GatewaySession?
    private var audio: AudioCapture?
    private var systemAudio: SystemAudioCapture?
    private var mixer: AudioMixer?
    private var notifTimer: Timer?
    private var scriptTimer: Timer?
    private var seenNotificationIds: Set<String> = []

    func bootstrap() async {
        do {
            let settings = try Settings.load()
            self.settings = settings
            self.client = AthenaClient(settings: settings)
            if settings.config.accessToken == nil || settings.config.accessToken?.isEmpty == true {
                self.status = .error("Sign in via the CLI: `athena signup` or `athena login`.")
                return
            }
            startNotificationPolling()
            startScriptPolling()
            // Replay any deep-link that arrived before we finished loading.
            if let pending = pendingDeepLink {
                pendingDeepLink = nil
                await startSession(title: pending.title, externalMeetingId: pending.externalMeetingId)
            }
        } catch SettingsError.configMissing(let msg) {
            self.status = .error(msg)
        } catch {
            self.status = .error("Failed to load CLI config: \(error.localizedDescription)")
        }
    }

    private func startNotificationPolling() {
        notifTimer?.invalidate()
        let timer = Timer(timeInterval: 10, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.refreshNotifications() }
        }
        RunLoop.main.add(timer, forMode: .common)
        notifTimer = timer
        Task { @MainActor in await refreshNotifications() }
    }

    private func refreshNotifications() async {
        guard let client = client else { return }
        do {
            let list = try await client.fetchUnreadNotifications()
            for n in list where !seenNotificationIds.contains(n.id) {
                SystemNotifications.post(n)
                seenNotificationIds.insert(n.id)
            }
            // Cap the seen set so it doesn't grow unbounded across long sessions.
            if seenNotificationIds.count > 500 {
                let keep = Set(list.map(\.id))
                seenNotificationIds = keep
            }
            self.notifications = list
        } catch {
            // ignore — best effort
        }
    }

    private func startScriptPolling() {
        scriptTimer?.invalidate()
        let timer = Timer(timeInterval: 30, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.refreshScripts() }
        }
        RunLoop.main.add(timer, forMode: .common)
        scriptTimer = timer
        Task { @MainActor in await refreshScripts() }
    }

    private func refreshScripts() async {
        guard let client = client else { return }
        do {
            let stages = try await client.fetchActiveScripts()
            self.scriptStages = stages
        } catch {
            // ignore — best effort
        }
    }

    func dismissNotification(_ id: String) {
        notifications.removeAll { $0.id == id }
        guard let client = client else { return }
        Task { await client.markNotificationRead(id: id) }
    }

    func startSession(title: String?, externalMeetingId: String? = nil) async {
        guard let client = self.client else { return }
        status = .starting
        do {
            let meeting = try await client.createMeeting(
                title: title,
                externalMeetingId: externalMeetingId
            )
            self.meetingId = meeting.id

            let task = try client.openSessionWebSocket()
            let session = GatewaySession(task: task)
            self.session = session

            session.onEvent = { [weak self] event in
                Task { @MainActor in self?.handleEvent(event) }
            }
            session.onDisconnect = { [weak self] err in
                Task { @MainActor in
                    if let err {
                        self?.status = .error("ws disconnected: \(err.localizedDescription)")
                    } else {
                        self?.status = .ended
                    }
                }
            }
            session.start()

            // Send hello once the server requests it (server emits hello.required first).
            // Audio engine starts only after we hear "ready".
        } catch ClientError.http(let status, let body) {
            self.status = .error("HTTP \(status): \(body)")
        } catch {
            self.status = .error(error.localizedDescription)
        }
    }

    /// Pending deep-link queued before bootstrap finished, applied after.
    private var pendingDeepLink: (externalMeetingId: String?, title: String?)?

    /// Triggered by the Chrome extension's `athena://start?meeting_id=…&title=…`
    /// link. If the user is already in a live session, no-op (PRD F1 AC3 spirit).
    /// If the controller hasn't bootstrapped yet, buffer the call and replay
    /// after `bootstrap()` finishes.
    func startFromDeepLink(externalMeetingId: String?, title: String?) async {
        // Drop if a session is already live or starting.
        if status == .live || status == .starting { return }
        if client == nil {
            pendingDeepLink = (externalMeetingId, title)
            return
        }
        await startSession(title: title, externalMeetingId: externalMeetingId)
    }

    func endSession() async {
        // Stop the mic + system audio immediately. Keep the WS open briefly so
        // we can receive recap.ready from the gateway, which auto-runs the
        // postcall job.
        audio?.stop()
        audio = nil
        if let sa = systemAudio {
            await sa.stop()
        }
        systemAudio = nil
        systemAudioActive = false
        mixer?.stop()
        mixer = nil
        session?.bye()
        status = .ended
    }

    func togglePause() {
        isPaused.toggle()
        // Audio stays running but we drop frames in the audio callback when paused.
        // Cleaner to stop/restart engine; simpler for v1 to drop.
    }

    func setRepLabel(_ label: String) {
        session?.setRep(label)
    }

    /// Submit useful / not_useful for the latest suggestion via the api service.
    /// Tracks local lastFeedback so the UI can show pressed state without a
    /// round-trip.
    @Published private(set) var lastFeedback: String?

    func submitFeedback(_ feedback: String) {
        guard let s = latestSuggestion, let id = s.suggestionId, let client = client else { return }
        lastFeedback = feedback
        Task { [client, id, feedback] in
            do {
                try await client.submitFeedback(suggestionId: id, feedback: feedback, action: nil)
            } catch {
                // best effort — keep optimistic state
            }
        }
    }

    private func handleEvent(_ event: ServerEvent) {
        switch event {
        case .helloRequired:
            session?.sendHello(
                meetingId: meetingId ?? "",
                sampleRate: 16_000,
                language: "en-US",
                vocabulary: [],
                repLabel: nil
            )
        case .ready(let sid, _):
            sessionId = sid
            status = .live
            startAudio()
        case .transcriptFinal(let segment, let speaker):
            rollingTurns.append((speaker: speaker, text: segment.text))
            if rollingTurns.count > 6 { rollingTurns.removeFirst(rollingTurns.count - 6) }
            if speaker == "customer" { lastCustomerText = segment.text }
        case .transcriptPartial:
            break
        case .suggestion(let s):
            latestSuggestion = s
            lastFeedback = nil
            if !s.intent.stageSignal.isEmpty {
                currentStage = s.intent.stageSignal
            }
        case .recap(let r):
            recap = r
            status = .ended
        case .errorEvent(let code, let message):
            status = .error("\(code): \(message)")
        case .closed(let reason):
            // If we already have a recap, prefer to keep .ended for the success state.
            if recap != nil {
                status = .ended
            } else {
                status = reason.isEmpty ? .ended : .error("closed: \(reason)")
            }
        case .unknown:
            break
        }
    }

    private func startAudio() {
        if captureSystemAudio {
            startMixedCapture()
        } else {
            startMicOnlyCapture()
        }
    }

    private func startMicOnlyCapture() {
        let cap = AudioCapture()
        self.audio = cap
        cap.onPCM = { [weak self] data in
            guard let self = self else { return }
            Task { @MainActor in
                guard !self.isPaused else { return }
                self.session?.sendAudio(data)
            }
        }
        do {
            try cap.start()
        } catch {
            status = .error("mic start failed: \(error.localizedDescription)")
        }
    }

    private func startMixedCapture() {
        let mixer = AudioMixer()
        self.mixer = mixer
        mixer.onMixedPCM = { [weak self] data in
            guard let self = self else { return }
            Task { @MainActor in
                guard !self.isPaused else { return }
                self.session?.sendAudio(data)
            }
        }
        mixer.start()

        let mic = AudioCapture()
        self.audio = mic
        mic.onPCM = { [weak self] data in
            self?.mixer?.pushMic(data)
        }
        do {
            try mic.start()
        } catch {
            status = .error("mic start failed: \(error.localizedDescription)")
            return
        }

        if #available(macOS 13.0, *) {
            let sa = SystemAudioCapture()
            self.systemAudio = sa
            sa.onPCM = { [weak self] data in
                self?.mixer?.pushSystem(data)
            }
            sa.onError = { [weak self] err in
                Task { @MainActor in
                    self?.status = .error("system audio: \(err.localizedDescription)")
                    self?.systemAudioActive = false
                }
            }
            Task { [weak self] in
                guard let self = self else { return }
                do {
                    try await sa.start()
                    await MainActor.run { self.systemAudioActive = true }
                } catch {
                    await MainActor.run {
                        self.status = .error(
                            "system audio start failed: \(error.localizedDescription) — grant Screen Recording in System Settings → Privacy."
                        )
                    }
                }
            }
        } else {
            status = .error("system audio requires macOS 13+")
        }
    }
}
