import SwiftUI

struct OverlayView: View {
    @ObservedObject var controller: SessionController
    @State private var meetingTitle: String = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !controller.notifications.isEmpty {
                notificationBanners
            }
            header
            Divider().opacity(0.2)
            content
        }
        .padding(12)
        .background(.ultraThinMaterial)
        .cornerRadius(14)
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .strokeBorder(Color.white.opacity(0.12), lineWidth: 1)
        )
        .frame(minWidth: 380, idealWidth: 440, maxWidth: 520)
        .frame(minHeight: 110)
    }

    private var notificationBanners: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(controller.notifications) { n in
                HStack(spacing: 8) {
                    Image(systemName: iconFor(n.kind))
                        .foregroundColor(.yellow)
                        .font(.system(size: 11, weight: .semibold))
                    VStack(alignment: .leading, spacing: 1) {
                        Text(n.title)
                            .font(.system(size: 11, weight: .semibold))
                        Text(n.body)
                            .font(.system(size: 10))
                            .foregroundColor(.secondary)
                            .lineLimit(2)
                    }
                    Spacer(minLength: 4)
                    Button(action: { controller.dismissNotification(n.id) }) {
                        Image(systemName: "xmark")
                            .font(.system(size: 9))
                    }
                    .buttonStyle(.plain)
                    .foregroundColor(.secondary)
                }
                .padding(8)
                .background(Color.yellow.opacity(0.12))
                .cornerRadius(6)
            }
        }
    }

    private func iconFor(_ kind: String) -> String {
        switch kind {
        case "suggestion.flagged": return "flag.fill"
        case "suggestion.commented": return "bubble.left.fill"
        case "billing.warn": return "creditcard"
        default: return "bell.fill"
        }
    }

    private var header: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(statusColor)
                .frame(width: 8, height: 8)
            Text(statusLabel)
                .font(.system(size: 11, weight: .medium))
                .foregroundColor(.secondary)
            if controller.status == .live && controller.systemAudioActive {
                Image(systemName: "speaker.wave.2.fill")
                    .font(.system(size: 10))
                    .foregroundColor(.secondary)
                    .help("System audio is being mixed in.")
            }
            Spacer()
            Button(action: { Task { await controller.endSession() } }) {
                Text("End")
                    .font(.system(size: 11, weight: .medium))
            }
            .buttonStyle(.plain)
            .keyboardShortcut("e", modifiers: [.command, .shift])
            .help("End session (⌘⇧E)")
            .opacity(controller.status == .live ? 1 : 0.3)
            .disabled(controller.status != .live)
        }
    }

    @ViewBuilder
    private var content: some View {
        switch controller.status {
        case .idle, .starting:
            idleView
        case .live:
            liveView
        case .ended:
            endedView
        case .error(let msg):
            VStack(alignment: .leading, spacing: 4) {
                Text(msg)
                    .font(.system(size: 11))
                    .foregroundColor(.red)
                    .fixedSize(horizontal: false, vertical: true)
                Button("Retry") { Task { await controller.bootstrap() } }
                    .padding(.top, 4)
            }
        }
    }

    @ViewBuilder
    private var endedView: some View {
        if let r = controller.recap {
            ScrollView(.vertical, showsIndicators: false) {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text("Recap — \(r.title ?? "(untitled)")")
                            .font(.system(size: 12, weight: .semibold))
                        Spacer()
                        if r.lowSignal {
                            Text("low signal")
                                .font(.system(size: 9, weight: .bold))
                                .padding(.horizontal, 5)
                                .padding(.vertical, 2)
                                .background(Color.yellow.opacity(0.4))
                                .cornerRadius(4)
                        }
                    }
                    Text(r.summary)
                        .font(.system(size: 11))
                        .fixedSize(horizontal: false, vertical: true)
                    Divider().opacity(0.2)
                    Text("Follow-up email")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundColor(.secondary)
                    Text(r.followupEmail.subject)
                        .font(.system(size: 11, weight: .medium))
                    Text(r.followupEmail.body)
                        .font(.system(size: 11))
                        .fixedSize(horizontal: false, vertical: true)
                    HStack {
                        Button("Copy email") {
                            let pb = NSPasteboard.general
                            pb.clearContents()
                            pb.setString(
                                "Subject: \(r.followupEmail.subject)\n\n\(r.followupEmail.body)",
                                forType: .string
                            )
                        }
                        Spacer()
                        Button("New call") {
                            Task {
                                await controller.startSession(
                                    title: meetingTitle.isEmpty ? nil : meetingTitle
                                )
                            }
                        }
                    }
                    .font(.system(size: 11))
                }
            }
            .frame(maxHeight: 320)
        } else {
            VStack(alignment: .leading, spacing: 4) {
                Text("Session ended. Generating recap…")
                    .font(.system(size: 12, weight: .semibold))
                Text("If this hangs, run `athena recap run \(controller.meetingId ?? "<id>")`.")
                    .font(.system(size: 10))
                    .foregroundColor(.secondary)
                Button("Start a new call") {
                    Task {
                        await controller.startSession(
                            title: meetingTitle.isEmpty ? nil : meetingTitle
                        )
                    }
                }
                .padding(.top, 4)
            }
        }
    }

    private var idleView: some View {
        VStack(alignment: .leading, spacing: 6) {
            TextField("Call title (optional)", text: $meetingTitle)
                .textFieldStyle(.roundedBorder)
                .font(.system(size: 12))
            Toggle(isOn: $controller.captureSystemAudio) {
                Text("Capture system audio (customer side)")
                    .font(.system(size: 11))
            }
            .toggleStyle(.switch)
            .controlSize(.small)
            .help("Uses ScreenCaptureKit. Grants Screen Recording permission on first use.")
            HStack {
                Button(action: {
                    Task {
                        await controller.startSession(title: meetingTitle.isEmpty ? nil : meetingTitle)
                    }
                }) {
                    HStack(spacing: 4) {
                        Image(systemName: "mic.fill")
                        Text("Start")
                    }
                }
                .keyboardShortcut("a", modifiers: [.command, .shift])
                .help("Start (⌘⇧A)")
                .disabled(controller.status == .starting)
                Spacer()
                Text("Tokens from `~/.athena/config.json`")
                    .font(.system(size: 10))
                    .foregroundColor(.secondary)
            }
        }
    }

    private var liveView: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Picker("", selection: $controller.checklistMode) {
                    Text("Compact").tag(false)
                    Text("Checklist").tag(true)
                }
                .pickerStyle(.segmented)
                .frame(width: 180)
                Spacer()
                Text(controller.currentStage)
                    .font(.system(size: 10, weight: .medium))
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Color.white.opacity(0.05))
                    .cornerRadius(4)
                    .foregroundColor(.secondary)
            }
            if controller.checklistMode {
                checklistView
            } else if let s = controller.latestSuggestion {
                suggestionCard(s)
            } else {
                Text("Listening… speak with the customer to trigger a suggestion.")
                    .font(.system(size: 11))
                    .foregroundColor(.secondary)
            }
            HStack(spacing: 8) {
                Button(action: { controller.togglePause() }) {
                    Image(systemName: controller.isPaused ? "play.fill" : "pause.fill")
                }
                .keyboardShortcut("p", modifiers: [.command, .shift])
                .help(controller.isPaused ? "Resume (⌘⇧P)" : "Pause (⌘⇧P)")
                if let last = controller.lastCustomerText {
                    Text(last)
                        .font(.system(size: 10))
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
                Spacer()
            }
        }
    }

    @ViewBuilder
    private var checklistView: some View {
        let blocks =
            controller.scriptStages
                .first(where: { $0.stage == controller.currentStage })?
                .blocks ?? []
        if blocks.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                Text("No published script for stage `\(controller.currentStage)`")
                    .font(.system(size: 11))
                    .foregroundColor(.secondary)
                Text("Publish one in admin-web → Scripts.")
                    .font(.system(size: 10))
                    .foregroundColor(.secondary.opacity(0.7))
            }
            .padding(8)
            .background(Color.primary.opacity(0.05))
            .cornerRadius(8)
        } else {
            ScrollView(.vertical, showsIndicators: false) {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(blocks) { b in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(b.collection)
                                .font(.system(size: 9, weight: .bold))
                                .foregroundColor(.secondary)
                            Text(b.bodyMd)
                                .font(.system(size: 11))
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .padding(8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.primary.opacity(0.05))
                        .cornerRadius(6)
                    }
                }
            }
            .frame(maxHeight: 240)
        }
    }

    private func suggestionCard(_ s: Suggestion) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Text(typeLabel(s.type))
                    .font(.system(size: 9, weight: .bold))
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(typeBackground(s.type))
                    .foregroundColor(.white)
                    .cornerRadius(4)
                Text(String(format: "conf %.2f", s.confidenceScore))
                    .font(.system(size: 10))
                    .foregroundColor(.secondary)
                Text("·")
                    .foregroundColor(.secondary)
                Text(s.intent.categories.joined(separator: ", "))
                    .font(.system(size: 10))
                    .foregroundColor(.secondary)
                    .lineLimit(1)
                Spacer()
            }
            if let text = s.answerText {
                Text(text)
                    .font(.system(size: 13, weight: .medium))
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let f = s.followupText {
                Text("Ask next: \(f)")
                    .font(.system(size: 11))
                    .foregroundColor(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if !s.sources.isEmpty {
                Text(s.sources.compactMap { $0.documentName }.joined(separator: " · "))
                    .font(.system(size: 9))
                    .foregroundColor(.secondary)
            }
            if s.suggestionId != nil {
                HStack(spacing: 6) {
                    Spacer()
                    Button(action: { controller.submitFeedback("useful") }) {
                        Label("Useful", systemImage: "hand.thumbsup")
                            .labelStyle(.iconOnly)
                            .font(.system(size: 11))
                    }
                    .buttonStyle(.plain)
                    .foregroundColor(controller.lastFeedback == "useful" ? .green : .secondary)
                    .keyboardShortcut(.upArrow, modifiers: [.command])
                    .help("Mark useful (⌘↑)")

                    Button(action: { controller.submitFeedback("not_useful") }) {
                        Label("Not useful", systemImage: "hand.thumbsdown")
                            .labelStyle(.iconOnly)
                            .font(.system(size: 11))
                    }
                    .buttonStyle(.plain)
                    .foregroundColor(controller.lastFeedback == "not_useful" ? .red : .secondary)
                    .keyboardShortcut(.downArrow, modifiers: [.command])
                    .help("Mark not useful (⌘↓)")

                    Button(action: {
                        if let text = s.answerText {
                            let pb = NSPasteboard.general
                            pb.clearContents()
                            pb.setString(text, forType: .string)
                        }
                    }) {
                        Image(systemName: "doc.on.doc")
                            .font(.system(size: 11))
                    }
                    .buttonStyle(.plain)
                    .foregroundColor(.secondary)
                    .disabled(s.answerText == nil)
                    .keyboardShortcut("c", modifiers: [.command, .shift])
                    .help("Copy answer (⌘⇧C)")
                }
                .padding(.top, 2)
            }
        }
        .padding(8)
        .background(Color.primary.opacity(0.05))
        .cornerRadius(8)
    }

    private var statusColor: Color {
        switch controller.status {
        case .live: return .green
        case .starting: return .orange
        case .idle, .ended: return .gray
        case .error: return .red
        }
    }

    private var statusLabel: String {
        switch controller.status {
        case .idle: return "ready"
        case .starting: return "connecting…"
        case .live:
            return controller.isPaused ? "paused" : "live"
        case .ended: return "ended"
        case .error: return "error"
        }
    }

    private func typeLabel(_ t: SuggestionType) -> String {
        switch t {
        case .answer: return "ANSWER"
        case .askNext: return "ASK NEXT"
        case .coach: return "COACH"
        case .risk: return "RISK"
        }
    }

    private func typeBackground(_ t: SuggestionType) -> Color {
        switch t {
        case .answer: return .green
        case .askNext: return .blue
        case .coach: return .yellow
        case .risk: return .red
        }
    }
}
