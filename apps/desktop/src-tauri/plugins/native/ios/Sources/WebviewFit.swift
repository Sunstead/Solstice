import GameController
import UIKit
import WebKit

/// Fits the webview to the app as a native view would be, rather than as a
/// web page in Safari is:
///
/// - It keeps its full height when the keyboard comes up, and tells the page
///   how much of its bottom a docked keyboard covers (the `keyboard` event:
///   `inset`, `docked`, `duration`). The page then makes room only in the
///   editor being typed in, as a native app would, rather than the whole app
///   shrinking and every pane and dialog moving. A floating keyboard, and the
///   small bar a hardware keyboard (or Scribble) brings up, cover a corner,
///   not the app's bottom edge: they report no inset. Whether a keyboard is
///   up at all, docked or floating (`shown`), is reported too: with none,
///   a finger's tap brings it back (`useKeyboardRefocus` on the page).
/// - The page itself never scrolls (only what's inside it does), so nothing
///   can drift. iOS would otherwise scroll it to keep a field above the
///   keyboard.
/// - It reaches the top of the window, under the status bar or the iPad's
///   menu bar, which the page pads for (`env(safe-area-inset-top)`) in its
///   own colour.
/// - No shortcuts bar over a hardware keyboard: Solstice's commands and menus
///   do what its Bold, Italic and Paste buttons would. Whether one is
///   attached goes with the `keyboard` event (`hardware`), so the page's own
///   keyboard bar stays away too.
@MainActor
final class WebviewFit: NSObject {
  /// A keyboard is at least this tall; the hardware keyboard's bar isn't.
  private static let keyboardMinimum: CGFloat = 150

  private weak var webview: WKWebView?
  private weak var plugin: NativePlugin?
  /// How much of the app's bottom the keyboard covers.
  private var covered: CGFloat = 0
  /// A keyboard is up, docked or floating.
  private var shown = false
  /// A hardware keyboard is attached.
  private var hardware = GCKeyboard.coalesced != nil
  private var observation: NSKeyValueObservation?

  init(_ webview: WKWebView, plugin: NativePlugin) {
    self.webview = webview
    self.plugin = plugin
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
    center.addObserver(self, selector: #selector(hardwareChanged), name: .GCKeyboardDidConnect, object: nil)
    center.addObserver(self, selector: #selector(hardwareChanged), name: .GCKeyboardDidDisconnect, object: nil)
  }

  @objc private func hardwareChanged() {
    let attached = GCKeyboard.coalesced != nil
    guard attached != hardware else { return }
    hardware = attached
    report(duration: 0.25)
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
    var up = false
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
      up = frame.intersection(bounds).height >= Self.keyboardMinimum
    }
    // The page hears of a hardware keyboard with the first focus too.
    let attached = GCKeyboard.coalesced != nil
    guard cover != covered || up != shown || attached != hardware || !reported else { return }
    covered = cover
    shown = up
    hardware = attached
    report(duration: note.userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double ?? 0.25)
  }

  /// Whether the page has heard anything yet.
  private var reported = false

  private func report(duration: Double) {
    reported = true
    // In the webview's CSS pixels, which are its points.
    plugin?.trigger(
      "keyboard",
      data: [
        "inset": Double(covered), "docked": covered > 0, "shown": shown, "duration": duration, "hardware": hardware,
      ])
  }
}
