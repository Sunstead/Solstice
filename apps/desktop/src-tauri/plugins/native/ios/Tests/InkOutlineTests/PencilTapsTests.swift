import ObjectiveC
import UIKit
import WebKit
import XCTest

@testable import tauri_plugin_solstice_native

/// WebKit observes the window a web view is in (key-value observing, which
/// gives the window a class of its own). Watching the window's events must
/// leave its class alone: a class made from KVO's broke observing it, and
/// the app crashed adding or removing a web view, printing a PDF or showing
/// the share sheet.
@MainActor
final class PencilTapsTests: XCTestCase {
  func testWatchingAWindowLeavesItsClassAlone() throws {
    let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 400, height: 300))
    let webview = WKWebView(frame: window.bounds)
    window.addSubview(webview)
    // As WebKit does, whether or not it already has.
    let observed = window.observe(\.windowScene) { _, _ in }
    let before: AnyClass? = object_getClass(window)

    let taps = PencilTaps(webview) { _ in }
    XCTAssertNotNil(taps)
    XCTAssertTrue(object_getClass(window) === before, "the window kept its class")

    // What crashed: WebKit adding and removing its observers.
    for _ in 0..<3 {
      let printer = WKWebView(frame: window.bounds)
      window.addSubview(printer)
      printer.removeFromSuperview()
    }
    webview.removeFromSuperview()
    observed.invalidate()
    withExtendedLifetime(taps) {}
  }
}
