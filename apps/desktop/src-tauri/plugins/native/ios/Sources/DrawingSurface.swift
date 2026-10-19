import CryptoKit
import PaperKit
import PencilKit
import SurfaceCore
import Tauri
import UIKit

/// An infinite drawing (`*.drawing.svg`), as in Freeform: one PaperKit
/// canvas you pan and zoom, Solstice's tools (`Ink`), the Pencil drawing from its
/// first touch (a finger pans, or draws too with finger drawing on: `Ink`).
/// Saved as an SVG (`DrawingFile`) whose markup is read back here.
final class DrawingSurface: SurfaceView, PaperMarkupViewController.Delegate {
  /// The canvas starts this big, the content in its middle, and grows when
  /// drawing nears an edge.
  private static let side: CGFloat = 16384
  private static let growBy: CGFloat = 8192
  private static let nearEdge: CGFloat = 2048
  private static let features: FeatureSet = {
    var features = FeatureSet.latest
    features.colorMaximumLinearExposure = 1
    return features
  }()

  private var controller: PaperMarkupViewController?
  /// It holds the tools (`Ink`): its canvas is first responder.
  private var hasTools = false
  private var unsaved = false
  /// The wait before a save; a new mark restarts it.
  private var pendingSave: Task<Void, Never>?
  /// Saves, one at a time. Never cancelled: marks made meanwhile are saved
  /// after the one under way.
  private let saves = Saves()
  /// What we last wrote, so our own save isn't taken for a change.
  private var written: String?
  /// When a stroke last began: no reload under a moving Pencil.
  private var drewAt: Date?
  /// Whether the last touch to land was the Pencil's: what drew the stroke
  /// that just ended.
  private let touchKind = TouchKind { _ in }
  private var scratcher: Scratcher?

  override init(id: String, path: String, plugin: NativePlugin) {
    super.init(id: id, path: path, plugin: plugin)

    let pencil = UILongPressGestureRecognizer(target: self, action: #selector(pencilDown(_:)))
    pencil.minimumPressDuration = 0
    pencil.allowedTouchTypes = [UITouch.TouchType.pencil.rawValue as NSNumber]
    pencil.cancelsTouchesInView = false
    pencil.delaysTouchesBegan = false
    pencil.delegate = self
    addGestureRecognizer(pencil)
    addGestureRecognizer(touchKind)

    Ink.shared.register(self)
    load()
  }

  private func load() {
    let text = (try? String(contentsOfFile: path, encoding: .utf8)) ?? ""
    var markup =
      DrawingFile.read(text)
      ?? PaperMarkup(bounds: CGRect(x: 0, y: 0, width: Self.side, height: Self.side))
    // White paper, as in Freeform, but painted by the view: PaperKit's own
    // paper would be drawn into the SVG's picture layer, over nothing.
    markup.backgroundColor = UIColor.clear.cgColor
    grow(&markup)

    controller.map(drop)
    let controller = PaperMarkupViewController(markup: markup, supportedFeatureSet: Self.features)
    controller.delegate = self
    controller.view.frame = bounds
    controller.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    showPaper(on: controller)
    controller.zoomRange = 0.1...8
    controller.isEditable = true
    Ink.shared.configure(controller)
    if let parent = plugin?.manager.viewController {
      parent.addChild(controller)
      addSubview(controller.view)
      controller.didMove(toParent: parent)
    } else {
      addSubview(controller.view)
    }
    self.controller = controller
    scratcher = Scratcher(markup)
    observeMarkup(of: controller) { [weak self, weak controller] in
      guard let self, let controller, self.controller === controller else { return }
      self.paperMarkupViewControllerDidChangeMarkup(controller)
    }
    opening = markup
    setNeedsLayout()
    if hasTools {
      DispatchQueue.main.async { controller.becomeFirstResponder() }
    }
  }

  /// The markup just loaded, until the surface has a size to show it in (its
  /// frame comes from the webview after it opens).
  private var opening: PaperMarkup?

  override func layoutSubviews() {
    super.layoutSubviews()
    guard let markup = opening, let controller, bounds.width > 0, bounds.height > 0 else { return }
    opening = nil
    // Starts on what's drawn (or the middle of an empty canvas).
    let content = markup.contentsRenderFrame
    let size = bounds.size
    let centre =
      content.isNull || content.isEmpty
      ? CGPoint(x: markup.bounds.midX, y: markup.bounds.midY)
      : CGPoint(x: content.midX, y: content.minY + min(content.height, size.height) / 2)
    controller.view.layoutIfNeeded()
    controller.setContentVisibleFrame(
      CGRect(x: centre.x - size.width / 2, y: centre.y - size.height / 2, width: size.width, height: size.height),
      animated: false)
  }

  /// Room to keep drawing: content near an edge moves inwards on a bigger
  /// canvas. Returns how far it moved.
  @discardableResult
  private func grow(_ markup: inout PaperMarkup) -> CGPoint {
    let content = markup.contentsRenderFrame
    guard !content.isNull, !content.isEmpty else { return .zero }
    let b = markup.bounds
    let near =
      content.minX - b.minX < Self.nearEdge || content.minY - b.minY < Self.nearEdge
      || b.maxX - content.maxX < Self.nearEdge || b.maxY - content.maxY < Self.nearEdge
    guard near else { return .zero }
    let shift = CGPoint(x: Self.growBy / 2, y: Self.growBy / 2)
    markup.transformContent(CGAffineTransform(translationX: shift.x, y: shift.y))
    markup.bounds = CGRect(x: b.minX, y: b.minY, width: b.width + Self.growBy, height: b.height + Self.growBy)
    return shift
  }

  /// Marks in hand: unsaved, being saved, or being drawn.
  private var busy: Bool {
    unsaved || pendingSave != nil || saves.running || drewAt.map { -$0.timeIntervalSinceNow < 5 } ?? false
  }

  override func reload() {
    // Ours win while marks are in hand (the sync keeps the other version
    // beside it if both changed).
    guard !busy else { return }
    Task { @MainActor [weak self] in
      guard let self else { return }
      // Our own save, or the same bytes written back: nothing new to show.
      if let written = self.written, await PdfStore.hash(self.path) == written { return }
      guard !self.busy else { return }
      // Back to the same place.
      let visible = self.controller?.contentVisibleFrame
      self.load()
      if let visible, let controller = self.controller {
        self.opening = nil
        controller.view.layoutIfNeeded()
        controller.setContentVisibleFrame(visible, animated: false)
      }
    }
  }

  // -- Editing ------------------------------------------------------------

  /// The paper: white, or dark with the ink's lightness swapped (the file
  /// keeps its true colours: `Paper`).
  private func showPaper(on controller: PaperMarkupViewController) {
    let dark = Ink.shared.darkPaper
    controller.overrideUserInterfaceStyle = Paper.style(dark: dark)
    controller.view.backgroundColor = Paper.colour(dark: dark)
  }

  override func paperChanged() {
    controller.map(showPaper)
  }

  override func inkChanged() {
    controller.map(Ink.shared.configure)
  }

  override var undoTarget: UndoManager? { controller?.undoManager }

  override func takeTools() {
    hasTools = true
    controller?.becomeFirstResponder()
  }

  override func dropTools() {
    hasTools = false
    controller?.resignFirstResponder()
    flush()
  }

  @objc private func pencilDown(_ gesture: UILongPressGestureRecognizer) {
    if gesture.state == .began { Ink.shared.activate(self, touched: true) }
  }

  func paperMarkupViewControllerDidBeginDrawing(_ controller: PaperMarkupViewController) {
    drewAt = Date()
  }

  override func insert(_ item: String, shape: String?) {
    guard let controller else { return }
    let visible = controller.contentVisibleFrame
    MarkupInsert.insert(
      item, shape: shape, into: controller, features: Self.features, centre: CGPoint(x: visible.midX, y: visible.midY),
      presenter: plugin?.manager.viewController)
  }

  func paperMarkupViewControllerDidChangeMarkup(_ controller: PaperMarkupViewController) {
    scratcher?.check(controller, pencil: touchKind.pencil)
    unsaved = true
    send("dirty")
    pendingSave?.cancel()
    pendingSave = Task { @MainActor [weak self] in
      try? await Task.sleep(for: .seconds(1))
      guard !Task.isCancelled, let self else { return }
      self.pendingSave = nil
      await self.save()
    }
  }

  // -- Find ------------------------------------------------------------

  /// Handwriting matching the find bar's query, in markup space.
  private var matches: [CGRect] = []
  private var active = -1

  override func find(_ query: String, caseSensitive: Bool, wholeWord: Bool) async -> Int {
    matches = []
    active = -1
    guard let markup = controller?.markup else { return 0 }
    matches = await handwriting(query, in: markup, caseSensitive: caseSensitive, wholeWord: wholeWord)
    if !matches.isEmpty {
      active = 0
      show(matches[0])
    }
    return matches.count
  }

  override func findStep(_ direction: Int) -> Int {
    guard !matches.isEmpty else { return -1 }
    active = (active + direction + matches.count) % matches.count
    show(matches[active])
    return active
  }

  private func show(_ rect: CGRect) {
    guard let controller else { return }
    let visible = controller.contentVisibleFrame
    if !visible.contains(rect) {
      controller.setContentVisibleFrame(
        CGRect(x: rect.midX - visible.width / 2, y: rect.midY - visible.height / 2, width: visible.width, height: visible.height),
        animated: true)
    }
    if let content = controller.contentView {
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { flash(rect, in: content) }
    }
  }

  // -- Saving ------------------------------------------------------------

  override func flush(_ done: @escaping () -> Void = {}) {
    pendingSave?.cancel()
    pendingSave = nil
    Task { @MainActor in
      await self.save()
      done()
    }
  }

  /// Writes what's unsaved, after any save already under way.
  private func save() async {
    await saves.run { [weak self] in
      guard let self, self.unsaved else { return }
      await self.write()
    }
  }

  private func write() async {
    guard unsaved, let controller, var markup = controller.markup else { return }
    unsaved = false

    // Near an edge: a bigger canvas, the view kept where it was.
    let shift = grow(&markup)
    if shift != .zero {
      let visible = controller.contentVisibleFrame
      controller.markup = markup
      controller.setContentVisibleFrame(visible.offsetBy(dx: shift.x, dy: shift.y), animated: false)
    }

    do {
      let svg = try await DrawingFile.write(markup)
      let path = self.path
      // Written off the main thread, through a temporary file.
      written = try await Task.detached(priority: .userInitiated) {
        let url = URL(fileURLWithPath: path)
        let temporary = url.deletingLastPathComponent()
          .appendingPathComponent(".\(url.lastPathComponent).saving")
        let data = Data(svg.utf8)
        try data.write(to: temporary)
        _ = try FileManager.default.replaceItemAt(url, withItemAt: temporary)
        return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
      }.value
      send("saved")
    } catch {
      unsaved = true
      send("error", ["message": "Couldn't save this drawing: \(error.localizedDescription)"])
    }
  }

  private func drop(_ controller: PaperMarkupViewController) {
    controller.willMove(toParent: nil)
    controller.view.removeFromSuperview()
    controller.removeFromParent()
  }
}

extension DrawingSurface: UIGestureRecognizerDelegate {
  func gestureRecognizer(
    _ gestureRecognizer: UIGestureRecognizer,
    shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer
  ) -> Bool { true }
}
