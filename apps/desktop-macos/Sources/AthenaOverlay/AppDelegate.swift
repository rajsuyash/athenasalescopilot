import AppKit
import SwiftUI

@main
@MainActor
struct AthenaApp {
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.run()
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var window: OverlayWindow?
    private let controller = SessionController()

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory) // menu-bar-style; no Dock icon
        SystemNotifications.requestAuthorizationIfNeeded()

        // Listen for athena:// URLs (registered in Info.plist > CFBundleURLTypes).
        // The Apple Event arrives early on cold launch — register before the
        // first run loop tick so we don't miss the inaugural URL.
        NSAppleEventManager.shared().setEventHandler(
            self,
            andSelector: #selector(handleURLEvent(_:reply:)),
            forEventClass: AEEventClass(kInternetEventClass),
            andEventID: AEEventID(kAEGetURL)
        )

        let window = makeOverlayWindow(controller: controller)
        self.window = window
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        Task { await controller.bootstrap() }
    }

    /// Modern URL routing — Cocoa calls this for each URL after launch.
    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls { route(url) }
    }

    /// Apple Event path — fires on cold launch when the URL is the launch reason.
    @objc func handleURLEvent(_ event: NSAppleEventDescriptor, reply _: NSAppleEventDescriptor) {
        guard
            let str = event.paramDescriptor(forKeyword: AEKeyword(keyDirectObject))?.stringValue,
            let url = URL(string: str)
        else {
            return
        }
        route(url)
    }

    private func route(_ url: URL) {
        guard url.scheme?.lowercased() == "athena" else { return }
        // Bring the overlay to the front so the user sees the result.
        NSApp.activate(ignoringOtherApps: true)
        self.window?.makeKeyAndOrderFront(nil)

        let host = url.host?.lowercased() ?? ""
        let path = url.path.lowercased()
        let action = host.isEmpty ? path.trimmingCharacters(in: CharacterSet(charactersIn: "/")) : host

        guard action == "start" else { return }
        let comps = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let items = comps?.queryItems ?? []
        let meetingId = items.first(where: { $0.name == "meeting_id" })?.value
        let title = items.first(where: { $0.name == "title" })?.value

        Task { @MainActor in
            await controller.startFromDeepLink(externalMeetingId: meetingId, title: title)
        }
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        // Best-effort end the meeting before quit.
        Task { @MainActor in
            await controller.endSession()
            NSApp.reply(toApplicationShouldTerminate: true)
        }
        return .terminateLater
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }
}
