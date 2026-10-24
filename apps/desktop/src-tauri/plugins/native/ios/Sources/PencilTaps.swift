import ObjectiveC
import UIKit
import WebKit
import os

private let pencilLog = Logger(subsystem: "app.solstice", category: "pencil")

/// Pencil taps that reached the window but none of WebKit's recognizers, sent
/// on to the page (the `pencilTap` event; `lib/pencil-taps.ts`). After a
/// Pencil tap, a system recognizer (Scribble's, it seems) keeps WebKit's from
/// being reset for a moment, so a quick next tap never reaches the page. The
/// window's `sendEvent` sees every touch, whatever the recognizers' state.
@MainActor
final class PencilTaps {
  /// How far a tap may move, and how long it may last (UIKit's own tap).
  private static let slop: CGFloat = 10
  private static let longest: TimeInterval = 0.5

  private weak var webview: WKWebView?
  /// The Pencil touches WebKit missed, by touch: where and when they landed.
  private var missed: [ObjectIdentifier: (at: CGPoint, time: TimeInterval)] = [:]
  private let send: (CGPoint) -> Void

  /// Watches `webview`'s window; `send` gets each missed tap, in the
  /// webview's points.
  init?(_ webview: WKWebView, send: @escaping (CGPoint) -> Void) {
    guard webview.window != nil else { return nil }
    self.webview = webview
    self.send = send
    Self.watch(with: self)
  }

  private func saw(_ event: UIEvent, in window: UIWindow) {
    guard event.type == .touches, let webview, webview.window === window, let touches = event.allTouches else { return }
    for touch in touches where touch.type == .pencil {
      let key = ObjectIdentifier(touch)
      switch touch.phase {
      case .began:
        if let view = touch.view, view.isDescendant(of: webview), Self.missedByWebKit(touch, in: webview) {
          missed[key] = (touch.location(in: webview), touch.timestamp)
        }
      case .moved:
        if let start = missed[key], start.at.distance(to: touch.location(in: webview)) > Self.slop {
          missed[key] = nil
        }
      case .ended:
        guard let start = missed.removeValue(forKey: key) else { continue }
        let at = touch.location(in: webview)
        if touch.timestamp - start.time <= Self.longest, start.at.distance(to: at) <= Self.slop {
          pencilLog.info("tap WebKit missed, handed to the page")
          send(at)
        }
      default:
        missed[key] = nil
      }
    }
  }

  /// Neither WebKit's touch events nor its click got `touch`. Nothing is
  /// missed if its touch-events recognizer can't be found.
  private static func missedByWebKit(_ touch: UITouch, in webview: WKWebView) -> Bool {
    let content = webview.scrollView.subviews.first { NSStringFromClass(type(of: $0)) == "WKContentView" }
    let theirs = content?.gestureRecognizers ?? []
    guard theirs.contains(where: { NSStringFromClass(type(of: $0)) == "WKTouchEventsGestureRecognizer" }) else {
      return false
    }
    let got = touch.gestureRecognizers ?? []
    return !got.contains { theirs.contains($0) && Self.webKitTaps.contains(NSStringFromClass(type(of: $0))) }
  }

  private static let webKitTaps: Set<String> = ["WKTouchEventsGestureRecognizer", "WKSyntheticTapGestureRecognizer"]

  /// Has `UIWindow`'s own `sendEvent` tell `taps` of each event once it's
  /// sent, leaving the window's class alone (`MethodHooks.swift`). Every
  /// window goes through here; `saw` keeps to the web view's.
  private static func watch(with taps: PencilTaps) {
    current = taps
    _ = sendEventSwapped
  }

  private static let sendEventSwapped: Void = {
    let selector = #selector(UIWindow.sendEvent(_:))
    replaceMethod(of: UIWindow.self, selector) { original in
      typealias SendEvent = @convention(c) (UIWindow, Selector, UIEvent) -> Void
      let send = unsafeBitCast(original, to: SendEvent.self)
      let block: @convention(block) (UIWindow, UIEvent) -> Void = { window, event in
        send(window, selector, event)
        MainActor.assumeIsolated { PencilTaps.current?.saw(event, in: window) }
      }
      return block
    }
  }()

  private static weak var current: PencilTaps?
}

extension CGPoint {
  fileprivate func distance(to other: CGPoint) -> CGFloat { hypot(other.x - x, other.y - y) }
}
