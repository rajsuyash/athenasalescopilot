import Foundation
import UserNotifications

/// Thin wrapper around UNUserNotificationCenter so the rep gets a system-level
/// banner when the overlay is occluded by the Meet window. Polling the inbox
/// already drives in-overlay banners; this surface is the catch-all for the
/// "I missed it because Meet was full-screen" failure mode.
@MainActor
enum SystemNotifications {
    private static var authorized = false
    private static var requested = false

    /// Ask once at launch. Silently no-ops if the user previously denied —
    /// the in-overlay banner is the fallback, so no need to nag.
    static func requestAuthorizationIfNeeded() {
        guard !requested else { return }
        requested = true
        UNUserNotificationCenter.current().requestAuthorization(
            options: [.alert, .sound]
        ) { granted, _ in
            Task { @MainActor in authorized = granted }
        }
    }

    /// Post a local notification mirroring an inbox entry. Identifier reuses
    /// the inbox row id so duplicate posts collapse into one banner.
    static func post(_ n: InboxNotification) {
        guard authorized else { return }
        let content = UNMutableNotificationContent()
        content.title = n.title
        content.body = n.body
        content.sound = .default
        content.threadIdentifier = n.kind
        if let link = n.linkPath {
            content.userInfo = ["linkPath": link]
        }
        let request = UNNotificationRequest(
            identifier: n.id,
            content: content,
            trigger: nil
        )
        UNUserNotificationCenter.current().add(request) { _ in }
    }
}
