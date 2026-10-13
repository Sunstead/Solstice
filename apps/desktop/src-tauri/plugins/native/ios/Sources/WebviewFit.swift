import UIKit
import WebKit

/// Fits the webview to the app as a native view would be, rather than as a
/// web page in Safari is:
///
/// - It ends at a docked on-screen keyboard. iOS otherwise leaves the page
///   its full height and scrolls it under the keyboard; the frontend undid
///   that scroll a frame later, which jittered, and writing with the Pencil
///   set off the same. A floating keyboard, and the small bar a hardware
///   keyboard (or Scribble) brings up, leave it be: they cover a corner, not
///   the app's bottom edge.
/// - The page itself never scrolls (only what's inside it does), so nothing
///   can drift.
/// - It reaches the top of the window, under the status bar or the iPad's
///   menu bar, which the page pads for (`env(safe-area-inset-top)`) in its
///   own colour.
/// - No shortcuts bar over a hardware keyboard: Solstice's commands and menus
///   do what its Bold, Italic and Paste buttons would.
@MainActor
final class WebviewFit: NSObject {
  /// A keyboard is at least this tall; the hardware keyboard's bar isn't.
  private static let keyboardMinimum: CGFloat = 150

  private weak var webview: WKWebView?
  /// How much of the app's bottom the keyboard covers.
  private var covered: CGFloat = 0
  private var observation: NSKeyValueObservation?

  init(_ webview: WKWebView) {
    self.webview = webview
    super.init()
    let scroll = webview.scrollView
    scroll.contentInsetAdjustmentBehavior = .never
    scroll.isScrollEnabled = false
    observation = scroll.observe(\.contentOffset, options: [.new]) { scroll, _ in
      MainActor.assumeIsolated {
        if scroll.contentOffset != .zero { scroll.contentOffset = .zero }
      }
    }
    noShortcutsBar()

    let center = NotificationCenter.default
    center.addObserver(
      self, selector: #selector(keyboard(_:)),
      name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
    center.addObserver(
      self, selector: #selector(keyboard(_:)),
      name: UIResponder.keyboardWillHideNotification, object: nil)
    center.addObserver(
      self, selector: #selector(keyboard(_:)),
      name: UIResponder.keyboardDidShowNotification, object: nil)
  }

  private func noShortcutsBar() {
    guard let item = webview?.inputAssistantItem else { return }
    item.leadingBarButtonGroups = []
    item.trailingBarButtonGroups = []
  }

  @objc private func keyboard(_ note: Notification) {
    guard let webview, let parent = webview.superview else { return }
    noShortcutsBar()
    var cover: CGFloat = 0
    if note.name != UIResponder.keyboardWillHideNotification,
      let end = note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect,
      let screen = parent.window?.windowScene?.screen
    {
      let frame = parent.convert(end, from: screen.coordinateSpace)
      let bounds = parent.bounds
      // Docked: it reaches the bottom of the screen, across the app.
      let docked = frame.maxY >= bounds.maxY - 1 && frame.minX <= bounds.minX + 1 && frame.maxX >= bounds.maxX - 1
      let overlap = bounds.maxY - frame.minY
      if docked, overlap >= Self.keyboardMinimum { cover = min(overlap, bounds.height) }
    }
    guard cover != covered else { return }
    covered = cover
    let duration = note.userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double ?? 0.25
    let curve = note.userInfo?[UIResponder.keyboardAnimationCurveUserInfoKey] as? UInt ?? 7
    UIView.animate(
      withDuration: duration, delay: 0,
      options: [UIView.AnimationOptions(rawValue: curve << 16), .beginFromCurrentState]
    ) {
      webview.frame = CGRect(
        x: 0, y: 0, width: parent.bounds.width, height: parent.bounds.height - cover)
    }
  }
}
