import CryptoKit
import PaperKit
import PencilKit
import SurfaceCore
import Tauri
import UIKit
import os

/// An infinite drawing (`*.drawing.svg`), as in Freeform: one PaperKit
/// canvas you pan and zoom, Solstice's tools (`Ink`), the Pencil drawing from its
/// first touch (a finger pans, or draws too with finger drawing on: `Ink`).
/// Saved as an SVG (`DrawingFile`) whose markup is read back here.
final class DrawingSurface: SurfaceView, PaperMarkupViewController.Delegate {
  /// The canvas is at least this big, what's drawn in its middle, and grows
  /// by half again when the view nears an edge. Its size costs nothing; a
  /// growth reloads the canvas, which in a big drawing takes a second. It
  /// starts at (0, 0): PaperKit's visible frame is counted from there
  /// whatever the markup's origin, so with any other the view opened far
  /// from the drawing and the Pencil's line missed its strokes.
  private static let side: CGFloat = 262_144
  private static let signposts = OSSignposter(subsystem: "app.solstice", category: "DrawingSurface")
  private static let features: FeatureSet = {
    var features = FeatureSet.latest
    features.colorMaximumLinearExposure = 1
    return features
  }()

  private var controller: PaperMarkupViewController?
  /// It holds the tools (`Ink`): its canvas is first responder.
  private var hasTools = false
  private var unsaved = false
  /// The file couldn't be read (or is a later format): shown as it is, never saved.
  private var readOnly = false
  /// The wait before a save; a new mark restarts it.
  private var pendingSave: Task<Void, Never>?
  /// How long to wait before a save: longer as saves get slower.
  private var savePacing = Pacing(least: 3, most: 30)
  /// Saves, one at a time. Never cancelled: marks made meanwhile are saved
  /// after the one under way.
  private let saves = Saves()
  /// What we last wrote, so our own save isn't taken for a change.
  private var written: String?
  /// Makes the file, keeping what it can from one save to the next.
  private let writer = DrawingFile.Writer()
  /// The handwriting recognised for the file's `<desc>`, and when to again.
  private var recognition = Recognition()
  /// When a stroke last began: no reload under a moving Pencil.
  private var drewAt: Date?
  private var scratcher: Scratcher?
  /// Reading the file, until the canvas is up.
  private var loading: Task<Void, Never>?
  private let spinner = UIActivityIndicatorView(style: .large)

  override init(id: String, path: String, plugin: NativePlugin) {
    super.init(id: id, path: path, plugin: plugin)

    let pencil = UILongPressGestureRecognizer(target: self, action: #selector(pencilDown(_:)))
    pencil.minimumPressDuration = 0
    pencil.allowedTouchTypes = [UITouch.TouchType.pencil.rawValue as NSNumber]
    pencil.cancelsTouchesInView = false
    pencil.delaysTouchesBegan = false
    pencil.delegate = self
    addGestureRecognizer(pencil)

    backgroundColor = Paper.colour(dark: Ink.shared.darkPaper)
    spinner.hidesWhenStopped = true
    addSubview(spinner)

    Ink.shared.register(self)
    load()
  }

  /// Reads the file off the main thread (a big drawing's markup takes
  /// seconds to parse), the paper and a spinner shown meanwhile, then shows
  /// it. `then` runs once it's shown.
  private func load(then: @escaping @MainActor () -> Void = {}) {
    loading?.cancel()
    spinner.startAnimating()
    let url = URL(fileURLWithPath: path)
    let state = Self.signposts.beginInterval("open")
    loading = Task { @MainActor [weak self] in
      let read = await Task.detached(priority: .userInitiated) {
        Result {
          var contents = try DrawingFile.read(contentsOf: url)
          // Made roomy here: moving every stroke takes a moment.
          if var markup = contents.markup {
            let shift = Self.roomy(&markup)
            contents.markup = markup
            contents.drawn = contents.drawn?.offsetBy(dx: shift.x, dy: shift.y)
          }
          return contents
        }
      }.value
      Self.signposts.endInterval("open", state)
      guard let self, !Task.isCancelled else { return }
      self.loading = nil
      self.spinner.stopAnimating()
      switch read {
      case .success(let contents):
        self.show(contents)
      case .failure(let error):
        self.readOnly = true
        self.send("error", ["message": error.localizedDescription])
      }
      then()
    }
  }

  private func show(_ contents: DrawingFile.Contents) {
    var markup = contents.markup ?? PaperMarkup(bounds: CGRect(x: 0, y: 0, width: Self.side, height: Self.side))
    // White paper, as in Freeform, but painted by the view: PaperKit's own
    // paper would be drawn into the SVG's picture layer, over nothing.
    markup.backgroundColor = UIColor.clear.cgColor

    controller.map(detach)
    Task { await writer.seed(contents.strokes) }
    // About half a millisecond an element, on the simulator.
    recognition = Recognition(text: contents.text, at: Date(), cost: Double(contents.elements) * 0.0005)
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
      insertSubview(controller.view, belowSubview: spinner)
      controller.didMove(toParent: parent)
    } else {
      insertSubview(controller.view, belowSubview: spinner)
    }
    self.controller = controller
    scratcher = Scratcher()
    observeMarkup(of: controller) { [weak self, weak controller] in
      guard let self, let controller, self.controller === controller else { return }
      self.paperMarkupViewControllerDidChangeMarkup(controller)
    }
    opening = contents.drawn ?? .null
    setNeedsLayout()
    if hasTools {
      DispatchQueue.main.async { controller.becomeFirstResponder() }
    }
  }

  /// Once the file has been read and its canvas is up (or it couldn't be).
  func shown() async {
    await loading?.value
  }

  /// What was drawn, as the file last saw it, until the surface has a size
  /// to show it in (its frame comes from the webview after it opens).
  private var opening: CGRect?

  override var paintsOwnGround: Bool { true }
  override var easedContent: UIView? { controller?.view }

  /// Its middle stays the drawing's middle at any size (`frame`), so at
  /// another size it's only moved, by half the difference; the paper round
  /// it is the surface's own ground, so no edge shows as it moves.
  override func easeTransform(showing size: CGSize) -> CGAffineTransform? {
    CGAffineTransform(translationX: (size.width - bounds.width) / 2, y: (size.height - bounds.height) / 2)
  }

  /// What was in view as the size last changed, to keep its middle there.
  private var shownBeforeResize: CGRect?

  /// A new size keeps the same point of the drawing in the middle, so what
  /// was in focus stays in focus (Zen mode, a rotation). PaperKit's canvas
  /// is resized with it from the top-left, and would drift.
  override var frame: CGRect {
    willSet {
      shownBeforeResize = newValue.size != frame.size && opening == nil ? controller?.contentVisibleFrame : nil
    }
    didSet {
      guard let shown = shownBeforeResize, let controller, oldValue.width > 0, bounds.width > 0 else { return }
      shownBeforeResize = nil
      let zoom = shown.width / oldValue.width
      let size = CGSize(width: bounds.width * zoom, height: bounds.height * zoom)
      controller.view.layoutIfNeeded()
      controller.setContentVisibleFrame(
        CGRect(x: shown.midX - size.width / 2, y: shown.midY - size.height / 2, width: size.width, height: size.height),
        animated: false)
    }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    spinner.center = CGPoint(x: bounds.midX, y: bounds.midY)
    guard let drawn = opening, let controller, bounds.width > 0, bounds.height > 0 else { return }
    opening = nil
    // Starts on what's drawn (or the middle of an empty canvas).
    let size = bounds.size
    let markup = controller.markup?.bounds ?? .zero
    let centre =
      drawn.isNull || drawn.isEmpty
      ? CGPoint(x: markup.midX, y: markup.midY)
      : CGPoint(x: drawn.midX, y: drawn.minY + min(drawn.height, size.height) / 2)
    controller.view.layoutIfNeeded()
    controller.setContentVisibleFrame(
      CGRect(x: centre.x - size.width / 2, y: centre.y - size.height / 2, width: size.width, height: size.height),
      animated: false)
  }

  /// At least `side` across, from (0, 0) (`grown`). Returns how far what's
  /// drawn moved.
  @discardableResult
  nonisolated static func roomy(_ markup: inout PaperMarkup) -> CGPoint {
    let b = markup.bounds
    return grown(&markup, to: CGSize(width: max(b.width, side), height: max(b.height, side)))
  }

  /// `size` from (0, 0), what was there moved into its middle. Returns how
  /// far it moved.
  nonisolated static func grown(_ markup: inout PaperMarkup, to size: CGSize) -> CGPoint {
    let b = markup.bounds
    let shift = CGPoint(x: (size.width - b.width) / 2 - b.minX, y: (size.height - b.height) / 2 - b.minY)
    if shift != .zero { markup.transformContent(CGAffineTransform(translationX: shift.x, y: shift.y)) }
    markup.bounds = CGRect(origin: .zero, size: size)
    return shift
  }

  /// Grows the canvas by half again when the view nears an edge (what's in
  /// view is all that can have been drawn on), the view kept on the same
  /// place. PaperKit draws a new markup afresh (the canvas blinks), so it's
  /// done seldom and as a stroke ends.
  private func growIfNeeded() {
    guard let controller, let bounds = controller.markup?.bounds else { return }
    let visible = controller.contentVisibleFrame
    let room = max(visible.width, visible.height)
    guard
      visible.minX - bounds.minX < room || visible.minY - bounds.minY < room
        || bounds.maxX - visible.maxX < room || bounds.maxY - visible.maxY < room
    else { return }
    DispatchQueue.main.async { [weak self] in
      guard let self, let controller = self.controller, var markup = controller.markup else { return }
      let b = markup.bounds
      let shift = Self.grown(&markup, to: CGSize(width: b.width * 1.5, height: b.height * 1.5))
      let visible = controller.contentVisibleFrame
      controller.markup = markup
      controller.setContentVisibleFrame(visible.offsetBy(dx: shift.x, dy: shift.y), animated: false)
      surfaceLog.info("grew \(self.id, privacy: .public) to \(Int(markup.bounds.width))")
    }
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
      surfaceLog.info("reload \(self.id, privacy: .public): changed on disk")
      // Back to the same place.
      let visible = self.controller?.contentVisibleFrame
      self.load { [weak self] in
        guard let self, let visible, let controller = self.controller else { return }
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
    backgroundColor = Paper.colour(dark: Ink.shared.darkPaper)
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
    scratcher?.track(gesture, on: controller)
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
    scratcher?.changed(controller)
    growIfNeeded()
    unsaved = true
    recognition.changed()
    dirty()
    pendingSave?.cancel()
    let wait = Duration.seconds(savePacing.wait)
    pendingSave = Task { @MainActor [weak self] in
      try? await Task.sleep(for: wait)
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
      // Still opening: nothing drawn yet to save.
      await self.loading?.value
      await self.save(final: true)
      self.leave()
      done()
    }
  }

  override func close() {
    super.close()
    controller.map(detach)
  }

  /// Writes what's unsaved, after any save already under way. `final`: the
  /// drawing is being left, so its handwriting is recognised afresh if it
  /// changed, even with nothing else to write.
  private func save(final: Bool = false) async {
    await saves.run { [weak self] in
      guard let self else { return }
      guard !self.readOnly, self.unsaved || (final && self.recognition.isDue(now: Date(), final: true)) else { return }
      await self.write(final: final)
    }
  }

  private func write(final: Bool) async {
    guard let controller, let markup = controller.markup else { return }
    unsaved = false
    let state = Self.signposts.beginInterval("save")
    let started = Date()
    // Recognising is paced on its own.
    var recognisingTook: TimeInterval = 0
    defer {
      Self.signposts.endInterval("save", state)
      savePacing.took(-started.timeIntervalSinceNow - recognisingTook)
    }

    do {
      let generation = recognition.generation
      var text = recognition.text ?? ""
      if recognition.isDue(now: Date(), final: final) {
        let recognising = Self.signposts.beginInterval("recognise")
        let asked = Date()
        text = await markup.indexableContent ?? ""
        recognisingTook = -asked.timeIntervalSinceNow
        recognition.recognised(text, of: generation, at: Date(), took: recognisingTook)
        Self.signposts.endInterval("recognise", recognising)
      }
      let writer = self.writer
      let svg = try await Task.detached(priority: .utility) { try await writer.write(markup, text: text) }.value
      let path = self.path
      // Written off the main thread, through a temporary file.
      written = try await Task.detached(priority: .utility) {
        let url = URL(fileURLWithPath: path)
        let temporary = url.deletingLastPathComponent()
          .appendingPathComponent(".\(url.lastPathComponent).saving")
        let data = Data(svg.utf8)
        try data.write(to: temporary)
        _ = try FileManager.default.replaceItemAt(url, withItemAt: temporary)
        return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
      }.value
      saved()
    } catch {
      unsaved = true
      send("error", ["message": "Couldn't save this drawing: \(error.localizedDescription)"])
    }
  }
}

extension DrawingSurface: UIGestureRecognizerDelegate {
  func gestureRecognizer(
    _ gestureRecognizer: UIGestureRecognizer,
    shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer
  ) -> Bool { true }
}
