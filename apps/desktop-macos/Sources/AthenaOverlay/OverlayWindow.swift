import AppKit
import SwiftUI

/// Always-on-top, borderless, click-through-resistant overlay window placed
/// near the top-center of the active screen (close to the camera notch on
/// Apple Silicon laptops). PRD F6.
final class OverlayWindow: NSWindow {
    init(rootView: NSView) {
        let initialFrame = NSRect(x: 0, y: 0, width: 460, height: 180)
        super.init(
            contentRect: initialFrame,
            styleMask: [.borderless, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        self.isOpaque = false
        self.backgroundColor = .clear
        self.hasShadow = true
        self.level = .floating
        self.collectionBehavior = [
            .canJoinAllSpaces,
            .fullScreenAuxiliary,
            .stationary,
        ]
        self.isMovableByWindowBackground = true
        self.titleVisibility = .hidden
        self.titlebarAppearsTransparent = true
        self.contentView = rootView
        self.center()
        self.positionNearCameraNotch()
    }

    func positionNearCameraNotch() {
        guard let screen = NSScreen.main ?? NSScreen.screens.first else { return }
        let visible = screen.visibleFrame
        let size = self.frame.size
        let x = visible.midX - size.width / 2
        let y = visible.maxY - size.height - 16 // 16pt gap from menu bar
        self.setFrameOrigin(NSPoint(x: x, y: y))
    }

    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}

/// Wraps a SwiftUI root view so we can hand an NSView to NSWindow.contentView.
@MainActor
func makeOverlayWindow(controller: SessionController) -> OverlayWindow {
    let host = NSHostingView(rootView: OverlayView(controller: controller))
    host.translatesAutoresizingMaskIntoConstraints = true
    host.autoresizingMask = [.width, .height]
    return OverlayWindow(rootView: host)
}
