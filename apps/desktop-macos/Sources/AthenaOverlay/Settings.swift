import Foundation

enum SettingsError: Error {
    case configMissing(String)
    case decodeFailed(Error)
}

/// Loads `~/.athena/config.json` written by the CLI. We share state with the
/// CLI on purpose so the user authenticates once and both surfaces work.
struct Settings {
    let config: CliConfig

    static func configURL() -> URL {
        let home = FileManager.default.homeDirectoryForCurrentUser
        return home.appendingPathComponent(".athena/config.json")
    }

    static func load() throws -> Settings {
        let url = configURL()
        guard FileManager.default.fileExists(atPath: url.path) else {
            throw SettingsError.configMissing(
                "Run `athena signup` (or `athena login`) in the CLI first — \(url.path) not found."
            )
        }
        let data = try Data(contentsOf: url)
        do {
            let decoder = JSONDecoder()
            let cfg = try decoder.decode(CliConfig.self, from: data)
            return Settings(config: cfg)
        } catch {
            throw SettingsError.decodeFailed(error)
        }
    }

    func gatewayWsURL(token: String) -> URL? {
        guard var components = URLComponents(string: config.gatewayUrl) else { return nil }
        components.scheme = (components.scheme == "https") ? "wss" : "ws"
        components.path = "/v1/sessions"
        components.queryItems = [URLQueryItem(name: "token", value: token)]
        return components.url
    }

    var apiBase: URL? { URL(string: config.apiUrl) }
}
