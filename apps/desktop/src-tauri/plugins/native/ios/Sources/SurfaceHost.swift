import ObjectiveC
import Tauri
import UIKit
import WebKit
import os

/// What the native views did, for Console (subsystem `app.solstice`): opens,
/// closes, reloads and why, memory warnings, canvases made and let go.
let surfaceLog = Logger(subsystem: "app.solstice", category: "surface")

/// A native view in a tab: a PDF, a drawing. The webview leaves a see-through
/// hole where it goes, and keeps its frame in step (`NativeSurface`).
class SurfaceView: UIView {
  let id: String
  var path: String
  weak var plugin: NativePlugin?

  /// How long a save waits after the last change: not between the strokes
  /// of a word, and little lost if the app is killed. Leaving the tab or the
  /// app saves at once (`flush`).
  static let saveAfter: Duration = .seconds(3)

  /// Changes not yet written have been reported (`dirty`).
  private var dirtySent = false
  /// Written since the file was last left (`leave`).
  private var wroteSinceLeft = false

  init(id: String, path: String, plugin: NativePlugin) {
    self.id = id
    self.path = path
    self.plugin = plugin
    super.init(frame: .zero)
    surfaceLog.info("open \(type(of: self), privacy: .public) \(id, privacy: .public)")
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError() }

  /// The file changed under it (another device, another app).
  func reload() {}

  /// Writes what's unsaved now (the tab is closing, the app is leaving),
  /// then calls `done`.
  func flush(_ done: @escaping () -> Void = {}) { done() }

  /// The tab closed, or another surface took its id: writes what's unsaved
  /// and lets go of its canvases. They were children of the app's view
  /// controller, and stayed there with their marks for as long as the app ran.
  func close() {
    surfaceLog.info("close \(type(of: self), privacy: .public) \(self.id, privacy: .public)")
    flush()
  }

  /// Takes `controller` out of the app's view controller and this view.
  func detach(_ controller: UIViewController) {
    controller.willMove(toParent: nil)
    controller.view.removeFromSuperview()
    controller.removeFromParent()
  }

  /// Something changed that isn't written yet; the web side hears once.
  func dirty() {
    guard !dirtySent else { return }
    dirtySent = true
    send("dirty")
  }

  /// A save was written.
  func saved() {
    dirtySent = false
    wroteSinceLeft = true
    send("saved")
  }

  /// The file is being left (`flush`): whatever was written since it was
  /// last left goes to the other devices now (`final`), not with the sync's
  /// next look at the folder.
  func leave() {
    guard wroteSinceLeft else { return }
    wroteSinceLeft = false
    send("saved", ["final": true])
  }

  /// Shown in its tab, in a window.
  var isShown: Bool { !isHidden && window != nil }

  override var isHidden: Bool {
    didSet { if oldValue != isHidden { Ink.shared.visibilityChanged(self) } }
  }

  /// Takes the tools: its canvas becomes first responder (`Ink`).
  func takeTools() {}

  /// Lets the tools go.
  func dropTools() {}

  /// The tool in hand, the ruler or finger drawing changed (`Ink`): give
  /// the canvases them.
  func inkChanged() {}

  /// What the ribbon's Undo and Redo act on: the canvas in view's.
  var undoTarget: UndoManager? { nil }

  /// Dark paper turned on or off (`Ink.setDarkPaper`): show the paper so.
  func paperChanged() {}

  /// The ribbon's + menu (`MarkupInsert`): `item` into the canvas in view.
  func insert(_ item: String, shape: String?) {}

  // -- Pages (a PDF's; the page sheet) ----------------------------------------

  /// How many pages, and which is in view (zero-based).
  var pages: (count: Int, current: Int) { (0, 0) }

  /// Page `index` with its marks, `width` points across, as a JPEG data URL.
  func thumbnail(_ index: Int, width: CGFloat) async -> String? { nil }

  /// Shows page `index`.
  func goToPage(_ index: Int) {}

  /// Puts the pages in `order` (indices of the pages as they are); pages
  /// left out are deleted. An error message if it couldn't.
  func arrangePages(_ order: [Int]) async -> String? { "This file has no pages to arrange." }

  /// Highlights `query`'s matches and shows the first; how many there are.
  func find(_ query: String, caseSensitive: Bool, wholeWord: Bool) async -> Int { 0 }

  /// Shows the next (or previous) match; its index, or -1 for none.
  func findStep(_ direction: Int) -> Int { -1 }

  /// Makes the first match on page `page` (zero-based) or after it the current
  /// one, preferring handwriting or text as `ink` says: where full-text search
  /// sends it. Returns the current match.
  func findPage(_ page: Int, ink: Bool) -> Int { -1 }

  func send(_ type: String, _ extra: JSObject = [:]) {
    var data: JSObject = ["id": id, "type": type, "path": path]
    data.merge(extra) { $1 }
    plugin?.trigger("surface", data: data)
  }
}

/// Holds the surfaces, under the webview, which is see-through. Touches over a
/// surface fall through the webview to it (see `routeTouches`), unless a web
/// menu or dialog is open, which takes them all so a tap outside it closes it
/// as it would on the web.
final class SurfaceHost: UIView {
  static weak var current: SurfaceHost?

  private(set) var surfaces: [String: SurfaceView] = [:]
  var webModal = false
  /// Web content over the surfaces that isn't modal (toasts), in host points.
  var webRects: [CGRect] = []

  func takesTouch(at point: CGPoint) -> Bool {
    if webModal || webRects.contains(where: { $0.contains(point) }) { return false }
    return surfaces.values.contains { !$0.isHidden && $0.frame.contains(point) }
  }

  func add(_ surface: SurfaceView) {
    remove(surface.id)
    surfaces[surface.id] = surface
    surface.isHidden = true
    addSubview(surface)
  }

  func remove(_ id: String) {
    guard let surface = surfaces.removeValue(forKey: id) else { return }
    Ink.shared.deactivate(surface)
    surface.close()
    surface.removeFromSuperview()
  }

  /// Every surface writes what's unsaved, then `done`.
  func flushAll(_ done: @escaping () -> Void) {
    let group = DispatchGroup()
    for surface in surfaces.values {
      group.enter()
      surface.flush { group.leave() }
    }
    group.notify(queue: .main, execute: done)
  }

  /// Sits under `webview`, the same size, and makes it see-through.
  static func install(under webview: WKWebView) -> SurfaceHost? {
    guard let parent = webview.superview else { return nil }
    let host = SurfaceHost(frame: webview.frame)
    host.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    parent.insertSubview(host, belowSubview: webview)
    webview.isOpaque = false
    webview.backgroundColor = .clear
    webview.scrollView.backgroundColor = .clear
    current = host
    routeTouches(of: webview)
    return host
  }

  /// Gives the webview's own class (wry's) a subclass whose hit test answers
  /// nothing over a surface, so UIKit goes on to the host underneath. A
  /// subclass of the real class, made at runtime, keeps wry's overrides.
  private static func routeTouches(of webview: WKWebView) {
    guard let base = object_getClass(webview) else { return }
    let name = "Solstice_" + NSStringFromClass(base)
    let selector = #selector(UIView.hitTest(_:with:))
    var made: AnyClass? = NSClassFromString(name)
    if made == nil, let subclass = objc_allocateClassPair(base, name, 0),
      let method = class_getInstanceMethod(base, selector)
    {
      typealias HitTest = @convention(c) (AnyObject, Selector, CGPoint, UIEvent?) -> UIView?
      let original = unsafeBitCast(class_getMethodImplementation(base, selector), to: HitTest.self)
      let block: @convention(block) (UIView, CGPoint, UIEvent?) -> UIView? = { view, point, event in
        if let host = SurfaceHost.current, host.takesTouch(at: view.convert(point, to: host)) {
          return nil
        }
        return original(view, selector, point, event)
      }
      class_addMethod(
        subclass, selector, imp_implementationWithBlock(block), method_getTypeEncoding(method))
      objc_registerClassPair(subclass)
      made = subclass
    }
    if let made { object_setClass(webview, made) }
  }
}

import Observation
import PaperKit

/// Calls `changed` whenever `controller`'s markup changes, however it
/// changed: the delegate isn't told about everything (an insert from the +
/// menu), Observation is.
@MainActor
func observeMarkup(of controller: PaperMarkupViewController, _ changed: @escaping () -> Void) {
  withObservationTracking {
    _ = controller.markup
  } onChange: { [weak controller] in
    DispatchQueue.main.async {
      guard let controller else { return }
      changed()
      observeMarkup(of: controller, changed)
    }
  }
}

import PencilKit

/// Where `query` is written by hand in `markup`, in the markup's coordinates.
@MainActor
func handwriting(
  _ query: String, in markup: PaperMarkup, caseSensitive: Bool, wholeWord: Bool
) async -> [CGRect] {
  let strokes = markup.subelements.strokes
  guard !query.isEmpty, !strokes.isEmpty else { return [] }
  // Rebuilt from their parts: PKDrawing(strokes:) throws (an Objective-C
  // exception, so a crash) on the strokes PaperKit hands out.
  let fresh = strokes.map { PKStroke(ink: $0.ink, path: $0.path, transform: $0.transform, mask: $0.mask) }
  let recognizer = PKStrokeRecognizer()
  await recognizer.updateDrawing(PKDrawing(strokes: fresh))
  let results = await recognizer.search(
    query, fullWordsOnly: wholeWord, caseMatchingOnly: caseSensitive)
  return results.map(\.bounds).sorted { ($0.minY, $0.minX) < ($1.minY, $1.minX) }
}

/// A moment's highlight over `rect`, in `view`'s coordinates: the find bar's
/// current match when it's handwriting, which has no text selection to show.
@MainActor
func flash(_ rect: CGRect, in view: UIView) {
  let mark = UIView(frame: rect.insetBy(dx: -4, dy: -4))
  mark.backgroundColor = UIColor.systemOrange.withAlphaComponent(0.35)
  mark.layer.cornerRadius = 4
  mark.isUserInteractionEnabled = false
  view.addSubview(mark)
  UIView.animate(withDuration: 0.4, delay: 1.6, options: []) { mark.alpha = 0 } completion: { _ in
    mark.removeFromSuperview()
  }
}

