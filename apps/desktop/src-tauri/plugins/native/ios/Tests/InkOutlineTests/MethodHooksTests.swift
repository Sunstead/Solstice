import ObjectiveC
import UIKit
import WebKit
import XCTest

@testable import tauri_plugin_solstice_native

/// WebKit observes the window a web view is in (key-value observing, which
/// gives an observed object a class of its own), and anything may observe the
/// web view or the application. What the plugin hooks must keep its class: a
/// class made from KVO's broke observing it, and the app crashed adding or
/// removing a web view, printing a PDF or showing the share sheet.
@MainActor
final class MethodHooksTests: XCTestCase {
  /// wry's web view is a subclass of WKWebView, as this is.
  private final class AppWebView: WKWebView {}

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

  func testRoutingTouchesLeavesTheWebViewsClassAlone() throws {
    let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 800, height: 600))
    let webview = AppWebView(frame: window.bounds)
    window.addSubview(webview)
    let observed = webview.observe(\.title) { _, _ in }
    let before: AnyClass? = object_getClass(webview)

    let host = try XCTUnwrap(SurfaceHost.install(under: webview))
    XCTAssertTrue(object_getClass(webview) === before, "the web view kept its class")

    // Touches over a shown surface still fall through to it; elsewhere
    // they're the web view's.
    let surface = SurfaceView(id: "s", path: "/nowhere.pdf", plugin: NativePlugin())
    host.add(surface)
    surface.frame = CGRect(x: 100, y: 100, width: 200, height: 200)
    surface.isHidden = false
    XCTAssertNil(webview.hitTest(CGPoint(x: 150, y: 150), with: nil))
    XCTAssertNotNil(webview.hitTest(CGPoint(x: 600, y: 500), with: nil))
    // Another web view (a PDF being printed) isn't routed.
    let other = AppWebView(frame: window.bounds)
    window.addSubview(other)
    XCTAssertNotNil(other.hitTest(CGPoint(x: 150, y: 150), with: nil))

    other.removeFromSuperview()
    host.remove("s")
    webview.removeFromSuperview()
    host.removeFromSuperview()
    observed.invalidate()
  }

  /// The application, as far as the menu goes (tests run without one).
  private final class App: UIResponder {
    @objc dynamic var badge = 0
  }

  func testTheMenuLeavesTheApplicationsClassAlone() {
    let app = App()
    let observed = app.observe(\.badge) { _, _ in }
    let before: AnyClass? = object_getClass(app)

    NativeMenu.install(on: app)
    XCTAssertTrue(object_getClass(app) === before, "the application kept its class")
    // The method its items call is there for UIKit to find.
    XCTAssertTrue(app.responds(to: NSSelectorFromString("solsticeMenuCommand:")))
    app.badge = 1
    observed.invalidate()
  }
}
