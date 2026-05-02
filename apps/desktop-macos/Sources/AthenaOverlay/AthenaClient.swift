import Foundation

enum ClientError: Error {
    case invalidURL
    case http(status: Int, body: String)
    case decode(Error)
}

/// REST + WebSocket client to the Athena services. Reuses the access token
/// stored by the CLI in `~/.athena/config.json`.
final class AthenaClient {
    let settings: Settings
    private let urlSession: URLSession

    init(settings: Settings) {
        self.settings = settings
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 15
        config.timeoutIntervalForResource = 60
        self.urlSession = URLSession(configuration: config)
    }

    /// Create a meeting via the api service so we can attach a WS session to it.
    func createMeeting(
        title: String?,
        externalMeetingId: String? = nil
    ) async throws -> (id: String, title: String?) {
        guard let base = settings.apiBase else { throw ClientError.invalidURL }
        var req = URLRequest(url: base.appendingPathComponent("/v1/meetings"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token = settings.config.accessToken {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        var body: [String: Any] = [:]
        if let title { body["title"] = title }
        if let externalMeetingId { body["externalMeetingId"] = externalMeetingId }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await urlSession.data(for: req)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let status = (response as? HTTPURLResponse)?.statusCode ?? -1
            throw ClientError.http(status: status, body: String(data: data, encoding: .utf8) ?? "")
        }
        guard let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let id = obj["id"] as? String else {
            throw ClientError.decode(NSError(domain: "athena", code: 0))
        }
        return (id, obj["title"] as? String)
    }

    func endMeeting(id: String) async throws {
        guard let base = settings.apiBase else { throw ClientError.invalidURL }
        let url = base.appendingPathComponent("/v1/meetings/\(id)/end")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token = settings.config.accessToken {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        req.httpBody = try JSONSerialization.data(withJSONObject: [:])
        let (_, response) = try await urlSession.data(for: req)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let status = (response as? HTTPURLResponse)?.statusCode ?? -1
            throw ClientError.http(status: status, body: "")
        }
    }

    func fetchUnreadNotifications() async throws -> [InboxNotification] {
        guard let base = settings.apiBase else { throw ClientError.invalidURL }
        var components = URLComponents(
            url: base.appendingPathComponent("/v1/notifications"),
            resolvingAgainstBaseURL: false
        )
        components?.queryItems = [
            URLQueryItem(name: "unreadOnly", value: "true"),
            URLQueryItem(name: "limit", value: "10"),
        ]
        guard let url = components?.url else { throw ClientError.invalidURL }
        var req = URLRequest(url: url)
        if let token = settings.config.accessToken {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let (data, response) = try await urlSession.data(for: req)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            return []
        }
        let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        let arr = (payload?["notifications"] as? [[String: Any]]) ?? []
        return arr.compactMap(InboxNotification.from(any:))
    }

    /// Fetch the currently published script blocks per stage.
    func fetchActiveScripts() async throws -> [ScriptStage] {
        guard let base = settings.apiBase else { throw ClientError.invalidURL }
        var req = URLRequest(url: base.appendingPathComponent("/v1/scripts/active"))
        if let token = settings.config.accessToken {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let (data, response) = try await urlSession.data(for: req)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            return []
        }
        let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        let arr = (payload?["stages"] as? [[String: Any]]) ?? []
        return arr.compactMap(ScriptStage.from(any:))
    }

    func markNotificationRead(id: String) async {
        guard let base = settings.apiBase else { return }
        let url = base.appendingPathComponent("/v1/notifications/\(id)/read")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token = settings.config.accessToken {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        req.httpBody = try? JSONSerialization.data(withJSONObject: [:])
        _ = try? await urlSession.data(for: req)
    }

    func submitFeedback(suggestionId: String, feedback: String, action: String?) async throws {
        guard let base = settings.apiBase else { throw ClientError.invalidURL }
        let url = base.appendingPathComponent("/v1/suggestions/\(suggestionId)/feedback")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token = settings.config.accessToken {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        var body: [String: Any] = ["feedback": feedback]
        if let action { body["action"] = action }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (_, response) = try await urlSession.data(for: req)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let status = (response as? HTTPURLResponse)?.statusCode ?? -1
            throw ClientError.http(status: status, body: "")
        }
    }

    /// Open a WebSocket to the realtime-gateway. Pass binary PCM frames via
    /// `task.send`. Read events via `task.receive` continuously.
    func openSessionWebSocket() throws -> URLSessionWebSocketTask {
        guard
            let token = settings.config.accessToken,
            let url = settings.gatewayWsURL(token: token)
        else {
            throw ClientError.invalidURL
        }
        return urlSession.webSocketTask(with: url)
    }
}

/// Thin wrapper over URLSessionWebSocketTask to centralize lifecycle.
final class GatewaySession {
    private let task: URLSessionWebSocketTask
    private var receiving = true

    var onEvent: ((ServerEvent) -> Void)?
    var onDisconnect: ((Error?) -> Void)?

    init(task: URLSessionWebSocketTask) {
        self.task = task
    }

    func start() {
        task.resume()
        receive()
    }

    func sendHello(meetingId: String, sampleRate: Int, language: String, vocabulary: [String], repLabel: String?) {
        var body: [String: Any] = [
            "type": "hello",
            "meetingId": meetingId,
            "sampleRate": sampleRate,
            "language": language,
        ]
        if !vocabulary.isEmpty { body["vocabulary"] = vocabulary }
        if let repLabel { body["repLabel"] = repLabel }
        sendJson(body)
    }

    func setRep(_ label: String) {
        sendJson(["type": "set_rep", "label": label])
    }

    func bye() {
        sendJson(["type": "bye"])
    }

    func sendAudio(_ data: Data) {
        let msg = URLSessionWebSocketTask.Message.data(data)
        task.send(msg) { _ in /* errors surface via receive loop */ }
    }

    func close() {
        receiving = false
        task.cancel(with: .normalClosure, reason: nil)
    }

    private func sendJson(_ obj: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: obj) else { return }
        let str = String(data: data, encoding: .utf8) ?? ""
        task.send(.string(str)) { _ in }
    }

    private func receive() {
        guard receiving else { return }
        task.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .failure(let err):
                self.receiving = false
                self.onDisconnect?(err)
            case .success(let msg):
                switch msg {
                case .string(let text):
                    if let data = text.data(using: .utf8) {
                        self.onEvent?(ServerEvent.decode(data))
                    }
                case .data(let data):
                    self.onEvent?(ServerEvent.decode(data))
                @unknown default:
                    break
                }
                self.receive()
            }
        }
    }
}
