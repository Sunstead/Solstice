import PDFKit
import PaperKit
import PencilKit
import SurfaceCore
import Tauri
import UIKit
import os

/// A PDF, in PDFKit (Apple's scrolling, zoom and text selection), marked up
/// with PaperKit as in Preview and Files: a markup canvas over each page, the
/// app's own tools (`Ink`), and the marks written into the PDF itself
/// (`PdfMarkup`, `PdfStore`), so every device and every reader shows them.
///
/// The Pencil draws from its first touch; a finger scrolls, zooms and
/// selects text, or draws too with finger drawing on (`Ink`).
final class PdfSurface: SurfaceView, PDFPageOverlayViewProvider, PaperMarkupViewController.Delegate {
  override var refitsToWidth: Bool { true }

  /// Everything PaperKit offers, in standard range: a page is printed paper,
  /// and HDR ink has no PDF equivalent.
  private static let features: FeatureSet = {
    var features = FeatureSet.latest
    features.colorMaximumLinearExposure = 1
    return features
  }()
  private static let signposts = OSSignposter(subsystem: "app.solstice", category: "PdfSurface")

  let pdfView = MarkupPDFView()
  /// It holds the tools (`Ink`): the page in view's canvas is first responder.
  private var hasTools = false
  /// The canvas over each page PDFKit is showing (or that has unsaved marks).
  private(set) var canvases:
    [ObjectIdentifier: (page: PDFPage, controller: PaperMarkupViewController, host: CanvasHost)] = [:]
  /// Each page's markup as the file holds it, until its canvas is made.
  private var stored: [ObjectIdentifier: Data] = [:]
  /// Ink Apple's Markup wrote on each page (Preview, Files), drawn by the
  /// page's canvas in place of Apple's blurry picture of it. Taken into the
  /// page's marks for good with the page's next save (`Edit.absorbed`).
  private var appleInks: [ObjectIdentifier: [(fingerprint: String, drawing: PKDrawing)]] = [:]
  /// The marks of canvases scrolled away, for when they're shown again.
  private var cached: [ObjectIdentifier: PaperMarkup] = [:]

  // -- Saving state ----------------------------------------------------------
  /// Pages with marks not yet written.
  private var unsaved = Set<ObjectIdentifier>()
  /// Pages added since the last save, in order.
  private var inserts: [PdfStore.Insert] = []
  /// Written by an old save: rewrite it once, as it's opened.
  private var repairing = false
  /// The wait before a save; a new mark restarts it.
  private var pendingSave: Task<Void, Never>?
  /// Saves, one at a time. Never cancelled: marks made meanwhile are saved
  /// after the one under way.
  private let saves = Saves()
  /// What we last wrote, so our own save (or a copy of it written back by
  /// sync) isn't taken for a change.
  private var written: String?
  /// When a stroke last began: no reload under a moving Pencil.
  private var drewAt: Date?
  /// Which canvases PDFKit has on their pages: only those it let go of go.
  private var onPages = PageCanvases<ObjectIdentifier>()
  /// Each canvas's scratching out (`Scratcher`), by page.
  private var scratchers: [ObjectIdentifier: Scratcher] = [:]
  /// A change from outside came while marks were in hand: look again after.
  private var reloadWanted = false
  /// The file is encrypted: PDFKit reads and writes the marks (`PdfMarkup`).
  private var encrypted = false

  override init(id: String, path: String, plugin: NativePlugin) {
    super.init(id: id, path: path, plugin: plugin)
    pdfView.frame = bounds
    pdfView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    pdfView.displayMode = .singlePageContinuous
    pdfView.displayDirection = .vertical
    pdfView.autoScales = true
    pdfView.pageShadowsEnabled = true
    // Room around each page, as Preview leaves.
    pdfView.displaysPageBreaks = true
    pdfView.pageBreakMargins = UIEdgeInsets(top: 12, left: 16, bottom: 12, right: 16)
    // The host's colour (what was under the tab) shows around the pages.
    pdfView.backgroundColor = .clear
    pdfView.pageOverlayViewProvider = self
    pdfView.fingerDraws = Ink.shared.fingerDraws
    addSubview(pdfView)

    // The Pencil on a page: that page's canvas takes the tools.
    let pencil = UILongPressGestureRecognizer(target: self, action: #selector(pencilDown(_:)))
    pencil.minimumPressDuration = 0
    pencil.allowedTouchTypes = [UITouch.TouchType.pencil.rawValue as NSNumber]
    pencil.cancelsTouchesInView = false
    pencil.delaysTouchesBegan = false
    pencil.delegate = self
    pdfView.addGestureRecognizer(pencil)

    NotificationCenter.default.addObserver(
      self, selector: #selector(pageChanged), name: .PDFViewPageChanged, object: pdfView)
    NotificationCenter.default.addObserver(
      self, selector: #selector(scaleChanged), name: .PDFViewScaleChanged, object: pdfView)

    Ink.shared.register(self)
    load()
  }

  /// Opens the file: its marks read off the main thread, then the document
  /// shown. `then` runs once it is.
  private func load(then: @escaping @MainActor (PDFDocument) -> Void = { _ in }) {
    let path = self.path
    Task { @MainActor [weak self] in
      let opened: PdfStore.Opened?
      var encrypted = false
      do {
        opened = try await PdfStore.read(path)
      } catch let failure as PdfStore.Failure where failure.encrypted {
        opened = nil
        encrypted = true
      } catch {
        opened = nil
      }
      guard let self else { return }
      guard let document = PaperPages.shared.document(at: URL(fileURLWithPath: path)) else {
        self.send("error", ["message": "Couldn't open this PDF."])
        return
      }
      self.encrypted = encrypted
      self.show(document, opened)
      then(document)
    }
  }

  private func show(_ document: PDFDocument, _ opened: PdfStore.Opened?) {
    stored = [:]
    appleInks = [:]
    cached = [:]
    var converting: [ObjectIdentifier] = []
    for index in 0..<document.pageCount {
      guard let page = document.page(at: index) else { continue }
      let key = ObjectIdentifier(page)
      // The page canvases draw Solstice's marks; the copies in the file are
      // for other readers.
      PdfMarkup.showCopies(false, on: page)
      if let base64 = opened?.pages[safe: index] ?? nil, let data = Data(base64Encoded: base64) {
        stored[key] = data
      }
      let box = page.bounds(for: .cropBox)
      for ink in opened?.apple?[safe: index] ?? [] {
        guard ink.rect.count == 4, let archive = Data(base64Encoded: ink.archive) else { continue }
        let rect = CGRect(x: ink.rect[0], y: ink.rect[1], width: ink.rect[2] - ink.rect[0], height: ink.rect[3] - ink.rect[1])
        guard let drawing = PdfMarkup.appleInk(archive, rect: rect, box: box) else { continue }
        appleInks[key, default: []].append((ink.fingerprint, drawing))
        PdfMarkup.hideAppleInk(at: rect, on: page)
      }
      if appleInks[key] != nil { converting.append(key) }
    }
    dropCanvases()
    pdfView.document = document
    Ink.letFingerDraw(Ink.shared.fingerDraws, in: pdfView)
    Ink.ignoreStatusBarTap(in: pdfView)
    // Apple's ink is written as Solstice's straight away, page shown or not:
    // until then every other reader shows Apple's blurry picture of it.
    unsaved.formUnion(converting)
    if opened?.needsRepair == true { repairing = true }
    if repairing || !converting.isEmpty { scheduleSave(after: .zero) }
  }

  /// Marks in hand: unsaved, being saved, or being drawn.
  private var busy: Bool {
    !unsaved.isEmpty || !inserts.isEmpty || repairing || pendingSave != nil || saves.running
      || drewAt.map { -$0.timeIntervalSinceNow < 5 } ?? false
  }

  override func reload() {
    // Ours win while marks are in hand; the file is looked at again once
    // they're written (the sync keeps the other version beside it if both
    // changed).
    if busy {
      reloadWanted = true
      if !saves.running, pendingSave == nil {
        // Only a stroke under way: look again once it's surely done.
        Task { @MainActor [weak self] in
          try? await Task.sleep(for: .seconds(5))
          self?.retryReload()
        }
      }
      return
    }
    Task { @MainActor [weak self] in
      guard let self else { return }
      // Our own save, or the same bytes written back: nothing new to show.
      if let written = self.written, await PdfStore.hash(self.path) == written { return }
      guard !self.busy else { return self.reloadWanted = true }
      surfaceLog.info("reload \(self.id, privacy: .public): changed on disk")
      self.reloadShowingTheSamePlace()
    }
  }

  private func retryReload() {
    guard reloadWanted else { return }
    reloadWanted = false
    reload()
  }

  /// Reloads at the same place: the same point of the same page, at the
  /// same zoom if the reader had zoomed.
  private func reloadShowingTheSamePlace() {
    let destination = pdfView.currentDestination
    let index = destination?.page.flatMap { pdfView.document?.index(for: $0) }
    let point = destination?.point
    let scale = pdfView.scaleFactor
    let zoomed = fitted.map { abs(scale - $0) >= 0.001 } ?? false
    load { [weak self] document in
      guard let self else { return }
      if zoomed {
        self.pdfView.scaleFactor = scale
      } else {
        self.pdfView.autoScales = true
        self.fitted = self.pdfView.scaleFactor
      }
      if let index, let point, let page = document.page(at: index) {
        self.pdfView.go(to: PDFDestination(page: page, at: point))
      }
    }
  }

  // -- Markup ------------------------------------------------------------

  func pdfView(_ view: PDFView, overlayViewFor page: PDFPage) -> UIView? {
    let key = ObjectIdentifier(page)
    onPages.shown(key)
    if let existing = canvases[key] { return existing.host }

    let size = page.bounds(for: .cropBox).size
    var markup = marks(of: page) ?? PaperMarkup(bounds: CGRect(origin: .zero, size: size))
    // The page shows through: PaperKit's canvas is otherwise white paper.
    markup.backgroundColor = UIColor.clear.cgColor
    let controller = PaperMarkupViewController(markup: markup, supportedFeatureSet: Self.features)
    controller.delegate = self
    // A page is paper (`Paper`): the ink reads as on white, or dark.
    controller.overrideUserInterfaceStyle = Paper.style(dark: Ink.shared.darkPaper)
    // Made before it's in a window, the canvas would draw at 1x.
    controller.traitOverrides.displayScale = displayScale
    controller.loadViewIfNeeded()
    clear(controller.view)
    controller.scrollConfiguration.isScrollEnabled = false
    controller.zoomRange = 0.1...Self.maximumZoom
    controller.isEditable = true
    Ink.shared.configure(controller)
    if let parent = plugin?.manager.viewController {
      parent.addChild(controller)
      controller.didMove(toParent: parent)
    }
    let host = CanvasHost(controller: controller, page: CGRect(origin: .zero, size: size))
    host.zoom = zoom
    canvases[key] = (page, controller, host)
    scratchers[key] = Scratcher()
    observeMarkup(of: controller) { [weak self, weak controller] in
      guard let self, let controller, self.canvases[key]?.controller === controller else { return }
      self.paperMarkupViewControllerDidChangeMarkup(controller)
    }
    surfaceLog.debug("canvas made: page \(page.document?.index(for: page) ?? -1)")
    // Made after this took the tools (still loading, or scrolled to).
    DispatchQueue.main.async { [weak self] in self?.pageChanged() }
    return host
  }

  /// What's marked on `page`: its canvas's if it has had one, else the
  /// file's, with Apple's ink on it.
  private func marks(of page: PDFPage) -> PaperMarkup? {
    let key = ObjectIdentifier(page)
    if let markup = canvases[key]?.controller.markup ?? cached[key] { return markup }
    var markup =
      stored[key].flatMap { try? PaperMarkup(dataRepresentation: $0) }
      ?? (encrypted ? PdfMarkup.read(page) : nil)
    guard let inks = appleInks[key], !inks.isEmpty else { return markup }
    if markup == nil { markup = PaperMarkup(bounds: CGRect(origin: .zero, size: page.bounds(for: .cropBox).size)) }
    for ink in inks { markup?.append(contentsOf: ink.drawing) }
    return markup
  }

  func pdfView(_ pdfView: PDFView, willEndDisplayingOverlayView overlayView: UIView, for page: PDFPage) {
    // Kept until saved when it has unsaved marks.
    let key = ObjectIdentifier(page)
    if onPages.ended(key, unsaved: unsaved.contains(key)) { dropCanvas(key) }
  }

  // -- Zoom ------------------------------------------------------------
  // PDFKit zooms by scaling the view the pages are in, canvases and all, so
  // PaperKit, never told, drew at 1x and was stretched: blurred ink, and its
  // handles and menus magnified. Each canvas draws at the zoom itself
  // instead, counter-scaled (`CanvasHost`), so ink is as sharp as the page
  // and PaperKit's own controls keep their size.

  /// Beyond this a page's canvas stops drawing sharper (memory).
  private static let maximumZoom: CGFloat = 8

  private var displayScale: CGFloat { window?.screen.scale ?? plugin?.manager.viewController?.view.window?.screen.scale ?? 2 }

  /// The zooms a page's canvas draws at. Drawing at another zoom draws the
  /// whole canvas afresh (the ink blinks), so it's redrawn only as PDFKit's
  /// zoom passes one of these, not after every pinch and resize.
  private static let zoomSteps: [CGFloat] = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, maximumZoom]

  /// The zoom the canvases draw at: the step at or above PDFKit's, so the
  /// ink is never softer than the page.
  private var zoom: CGFloat {
    let scale = pdfView.scaleFactor
    return Self.zoomSteps.first { $0 >= scale - 0.001 } ?? Self.maximumZoom
  }

  private var rezoom: DispatchWorkItem?

  @objc private func scaleChanged() {
    // Once a pinch settles: redrawing every frame of it would stutter.
    rezoom?.cancel()
    let work = DispatchWorkItem { [weak self] in
      guard let self else { return }
      let zoom = self.zoom
      self.canvases.values.forEach { $0.host.zoom = zoom }
    }
    rezoom = work
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.15, execute: work)
  }

  private func clear(_ view: UIView) {
    view.backgroundColor = .clear
    view.isOpaque = false
    view.subviews.forEach(clear)
  }

  override func paperChanged() {
    let style = Paper.style(dark: Ink.shared.darkPaper)
    canvases.values.forEach { $0.controller.overrideUserInterfaceStyle = style }
    redrawPages()
  }

  /// PDFKit draws the pages again (its tiles are layers of their own).
  private func redrawPages() {
    func invalidate(_ layer: CALayer) {
      layer.setNeedsDisplay()
      layer.sublayers?.forEach(invalidate)
    }
    invalidate(pdfView.layer)
    pdfView.layoutDocumentView()
  }

  override func inkChanged() {
    pdfView.fingerDraws = Ink.shared.fingerDraws
    // PDFKit's own scrolling too: two fingers while one draws.
    Ink.letFingerDraw(Ink.shared.fingerDraws, in: pdfView)
    canvases.values.forEach { Ink.shared.configure($0.controller) }
  }

  override var undoTarget: UndoManager? { current?.undoManager }

  override func takeTools() {
    hasTools = true
    current?.becomeFirstResponder()
  }

  override func dropTools() {
    hasTools = false
    canvases.values.forEach { $0.controller.resignFirstResponder() }
    flush()
  }

  /// The canvas of the page in view.
  private var current: PaperMarkupViewController? {
    guard let page = pdfView.currentPage else { return canvases.values.first?.controller }
    return canvases[ObjectIdentifier(page)]?.controller
  }

  @objc private func pencilDown(_ gesture: UILongPressGestureRecognizer) {
    if gesture.state == .began {
      Ink.shared.activate(self, touched: true)
      // The page under the Pencil holds the tools, and is the one it's on.
      let point = gesture.location(in: pdfView)
      penPage = pdfView.page(for: point, nearest: true).map(ObjectIdentifier.init)
      if let penPage, let controller = canvases[penPage]?.controller, !controller.isFirstResponder {
        controller.becomeFirstResponder()
      }
    }
    if let penPage { scratchers[penPage]?.track(gesture, on: canvases[penPage]?.controller) }
  }

  /// The page the Pencil came down on.
  private var penPage: ObjectIdentifier?

  @objc private func pageChanged() {
    // A new page in view: its canvas takes the tools, if this has them.
    guard hasTools, let current, !current.isFirstResponder else { return }
    current.becomeFirstResponder()
    Ink.shared.sendUndo()
  }

  override func insert(_ item: String, shape: String?) {
    if item == "addPage" { return addPage() }
    guard let page = pdfView.currentPage, let controller = canvases[ObjectIdentifier(page)]?.controller else { return }
    MarkupInsert.insert(
      item, shape: shape, into: controller, features: Self.features, centre: visibleCentre(of: page),
      presenter: plugin?.manager.viewController)
  }

  /// The middle of what shows of `page`, in its markup's space (y down).
  private func visibleCentre(of page: PDFPage) -> CGPoint {
    let box = page.bounds(for: .cropBox)
    let shown = pdfView.convert(pdfView.bounds, to: page).intersection(box)
    let area = shown.isNull || shown.isEmpty ? box : shown
    return CGPoint(x: area.midX - box.minX, y: box.maxY - area.midY)
  }

  // -- Pages ----------------------------------------------------------------

  override var pages: (count: Int, current: Int) {
    guard let document = pdfView.document else { return (0, 0) }
    return (document.pageCount, pdfView.currentPage.map { document.index(for: $0) } ?? 0)
  }

  override func thumbnail(_ index: Int, width: CGFloat) async -> String? {
    guard let page = pdfView.document?.page(at: index) else { return nil }
    let box = page.bounds(for: .cropBox)
    guard box.width > 0 else { return nil }
    let size = CGSize(width: width, height: width * box.height / box.width)
    let markup = marks(of: page)
    let format = UIGraphicsImageRendererFormat()
    format.scale = displayScale
    format.opaque = true
    let renderer = UIGraphicsImageRenderer(size: size, format: format)
    // The page as PDFKit draws it (white, light whatever the paper), then
    // the marks on it, as every reader shows them.
    var art: CGImage?
    if let markup {
      art = await PdfMarkup.picture(of: markup, size: size, scale: displayScale)
    }
    let image = renderer.image { context in
      UIColor.white.setFill()
      context.fill(CGRect(origin: .zero, size: size))
      let cg = context.cgContext
      cg.saveGState()
      cg.translateBy(x: 0, y: size.height)
      cg.scaleBy(x: size.width / box.width, y: -size.height / box.height)
      cg.translateBy(x: -box.minX, y: -box.minY)
      page.draw(with: .cropBox, to: cg)
      cg.restoreGState()
      if let art { UIImage(cgImage: art).draw(in: CGRect(origin: .zero, size: size)) }
    }
    guard let jpeg = image.jpegData(compressionQuality: 0.8) else { return nil }
    return "data:image/jpeg;base64," + jpeg.base64EncodedString()
  }

  override func goToPage(_ index: Int) {
    guard let page = pdfView.document?.page(at: index) else { return }
    pdfView.go(to: page)
  }

  override func arrangePages(_ order: [Int]) async -> String? {
    guard !encrypted else { return "Pages of an encrypted PDF can't be rearranged here." }
    // Everything pending goes to the file first, so its pages are the ones
    // shown and the order counts the same pages.
    await save()
    guard let document = pdfView.document else { return "The PDF isn't open." }
    let count = document.pageCount
    guard !order.isEmpty, Set(order).count == order.count, order.allSatisfy({ (0..<count).contains($0) }) else {
      return "That isn't an order of this PDF's pages."
    }
    let before = (0..<count).compactMap { document.page(at: $0) }
    // Pages that go take their marks with them.
    for (index, page) in before.enumerated() where !order.contains(index) {
      let key = ObjectIdentifier(page)
      dropCanvas(key, keep: false)
      unsaved.remove(key)
      stored[key] = nil
      cached[key] = nil
      appleInks[key] = nil
    }
    for index in stride(from: count - 1, through: 0, by: -1) { document.removePage(at: index) }
    for (place, index) in order.enumerated() { document.insert(before[index], at: place) }
    pdfView.layoutDocumentView()

    var failure: String?
    await saves.run { [weak self] in
      guard let self else { return }
      do {
        self.written = try await PdfStore.save(self.path, PdfStore.Request(order: order)).hash
        self.saved()
      } catch {
        failure = "Couldn't save the pages: \(error.localizedDescription)"
      }
    }
    if let failure { send("error", ["message": failure]) }
    return failure
  }

  /// A page after the one in view, with the document's background (a
  /// notebook's), the size of its last page.
  private func addPage() {
    guard let document = pdfView.document else { return }
    let size = document.page(at: document.pageCount - 1)?.bounds(for: .cropBox) ?? Notebook.a4
    guard
      let data = Notebook.pageData(
        template: Notebook.template(of: document), size: CGRect(origin: .zero, size: size.size)),
      let page = PaperPages.shared.document(data: data)?.page(at: 0)
    else { return }
    let at = (pdfView.currentPage.map { document.index(for: $0) } ?? document.pageCount - 1) + 1
    document.insert(page, at: at)
    pdfView.go(to: page)
    inserts.append(PdfStore.Insert(at: at, pdf: data.base64EncodedString()))
    scheduleSave()
  }

  func paperMarkupViewControllerDidBeginDrawing(_ controller: PaperMarkupViewController) {
    drewAt = Date()
  }

  func paperMarkupViewControllerDidChangeMarkup(_ controller: PaperMarkupViewController) {
    guard let entry = canvases.first(where: { $0.value.controller === controller }) else { return }
    scratchers[entry.key]?.changed(controller)
    unsaved.insert(entry.key)
    scheduleSave()
  }

  private func scheduleSave(after wait: Duration = saveAfter) {
    dirty()
    pendingSave?.cancel()
    pendingSave = Task { @MainActor [weak self] in
      try? await Task.sleep(for: wait)
      guard !Task.isCancelled, let self else { return }
      self.pendingSave = nil
      await self.save()
    }
  }

  // -- Saving ------------------------------------------------------------

  override func flush(_ done: @escaping () -> Void = {}) {
    pendingSave?.cancel()
    pendingSave = nil
    Task { @MainActor in
      await self.save()
      self.leave()
      done()
    }
  }

  override func close() {
    super.close()
    // Out of the app's view controller now; kept here until the save
    // under way has read their marks.
    canvases.values.forEach { detach($0.controller) }
  }

  /// Writes what's unsaved, after any save already under way.
  private func save() async {
    await saves.run { [weak self] in
      guard let self, !self.unsaved.isEmpty || !self.inserts.isEmpty || self.repairing else { return }
      await self.write()
    }
    if reloadWanted, !busy { retryReload() }
  }

  /// Writes the changed pages' marks into the file, off the main thread
  /// once they're collected.
  private func write() async {
    guard let document = pdfView.document else { return }
    let state = Self.signposts.beginInterval("save")
    defer { Self.signposts.endInterval("save", state) }

    // Taken all at once, so page numbers and added pages agree. A page with
    // no canvas (Apple's ink converted on open) saves the marks it would show.
    let byKey = Dictionary(
      (0..<document.pageCount).compactMap { document.page(at: $0) }.map { (ObjectIdentifier($0), $0) },
      uniquingKeysWith: { first, _ in first })
    let pages = unsaved.compactMap { key -> (key: ObjectIdentifier, page: PDFPage, markup: PaperMarkup?, index: Int)? in
      if let canvas = canvases[key] {
        return (key, canvas.page, canvas.controller.markup, document.index(for: canvas.page))
      }
      guard let page = byKey[key] else { return nil }
      return (key, page, marks(of: page), document.index(for: page))
    }
    let inserts = self.inserts
    let repairing = self.repairing
    unsaved.removeAll()
    self.inserts.removeAll()
    self.repairing = false

    var saved = false
    if encrypted {
      saved = await writeWithPDFKit(document, pages.map { ($0.page, $0.markup) })
    } else {
      var request = PdfStore.Request(inserts: inserts)
      do {
        let collect = Self.signposts.beginInterval("collect")
        for entry in pages {
          guard let markup = entry.markup else { continue }
          let absorbed = appleInks[entry.key]?.map(\.fingerprint) ?? []
          request.edits.append(
            try await PdfMarkup.edit(of: markup, page: entry.page, index: entry.index, absorbed: absorbed))
        }
        Self.signposts.endInterval("collect", collect)
        if !request.isEmpty || repairing {
          written = try await PdfStore.save(path, request).hash
        }
        saved = true
      } catch {
        send("error", ["message": "Couldn't save the markup: \(error.localizedDescription)"])
      }
    }

    if saved {
      // Apple's ink on these pages is Solstice's now, in the file too.
      if !encrypted {
        for entry in pages {
          appleInks[entry.key] = nil
          // Its canvas, when it's made, starts from what was written.
          if canvases[entry.key] == nil { cached[entry.key] = entry.markup }
        }
      }
      self.saved()
    } else {
      // Kept to try again with the next change.
      for entry in pages { unsaved.insert(entry.key) }
      self.inserts = inserts + self.inserts
    }
    // Canvases PDFKit let go of while unsaved can go now; one it still has
    // on its page (just off screen) stays, or it would go on showing there
    // with no tools and nothing saved.
    for key in onPages.afterSave(pages.map(\.key), unsaved: unsaved) {
      dropCanvas(key)
    }
  }

  private func writeWithPDFKit(_ document: PDFDocument, _ pages: [(PDFPage, PaperMarkup?)]) async -> Bool {
    for (page, markup) in pages {
      guard let markup else { continue }
      do {
        try await PdfMarkup.replace(markup, on: page)
      } catch {
        send("error", ["message": "Couldn't save the markup: \(error.localizedDescription)"])
        return false
      }
    }
    guard PdfMarkup.writeWithPDFKit(document, to: path) else {
      send("error", ["message": "Couldn't save this PDF."])
      return false
    }
    written = await PdfStore.hash(path)
    return true
  }

  /// `keep`: its marks stay at hand for when it's shown again (it was
  /// scrolled away, not reloaded).
  private func dropCanvas(_ key: ObjectIdentifier, keep: Bool = true) {
    guard let entry = canvases.removeValue(forKey: key) else { return }
    surfaceLog.debug("canvas let go: page \(entry.page.document?.index(for: entry.page) ?? -1)")
    onPages.forget(key)
    scratchers[key] = nil
    if keep, let markup = entry.controller.markup { cached[key] = markup }
    let wasResponder = entry.controller.isFirstResponder
    entry.controller.willMove(toParent: nil)
    entry.controller.removeFromParent()
    if wasResponder { pageChanged() }
  }

  private func dropCanvases() {
    canvases.keys.forEach { dropCanvas($0, keep: false) }
    unsaved.removeAll()
  }

  // -- Find ------------------------------------------------------------

  /// A find match: in the page's text, or written by hand (page space).
  private enum Match {
    case text(PDFSelection)
    case ink(PDFPage, CGRect)
  }

  private var matches: [Match] = []
  private var active = -1

  override func find(_ query: String, caseSensitive: Bool, wholeWord: Bool) async -> Int {
    matches = []
    active = -1
    defer { showMatches() }
    guard !query.isEmpty, let document = pdfView.document else { return 0 }
    var pattern = NSRegularExpression.escapedPattern(for: query)
    if wholeWord { pattern = "\\b\(pattern)\\b" }
    let regex = try? NSRegularExpression(
      pattern: pattern, options: caseSensitive ? [] : [.caseInsensitive])
    var found: [Match] = []
    for index in 0..<document.pageCount {
      guard let page = document.page(at: index) else { continue }
      if let regex, let text = page.string {
        let range = NSRange(text.startIndex..., in: text)
        for match in regex.matches(in: text, range: range) {
          if let selection = page.selection(for: match.range) { found.append(.text(selection)) }
        }
      }
      // Marks on screen are the canvas's; otherwise what the file holds.
      if let markup = marks(of: page) {
        let box = page.bounds(for: .cropBox)
        for rect in await handwriting(query, in: markup, caseSensitive: caseSensitive, wholeWord: wholeWord) {
          // Markup space is top-left; the page's bottom-left.
          let onPage = CGRect(x: box.minX + rect.minX, y: box.maxY - rect.maxY, width: rect.width, height: rect.height)
          found.append(.ink(page, onPage))
        }
      }
    }
    matches = found
    if !matches.isEmpty { active = 0 }
    return matches.count
  }

  override func findStep(_ direction: Int) -> Int {
    guard !matches.isEmpty else { return -1 }
    active = (active + direction + matches.count) % matches.count
    showMatches()
    return active
  }

  override func findPage(_ page: Int, ink: Bool) -> Int {
    guard let document = pdfView.document, !matches.isEmpty else { return active }
    func index(of match: Match) -> (page: Int, ink: Bool) {
      switch match {
      case .text(let selection): (selection.pages.first.map { document.index(for: $0) } ?? 0, false)
      case .ink(let on, _): (document.index(for: on), true)
      }
    }
    let after = matches.indices.filter { index(of: matches[$0]).page >= page }
    let preferred = after.first { index(of: matches[$0]).page == page && index(of: matches[$0]).ink == ink }
    guard let first = preferred ?? after.first else {
      return active
    }
    active = first
    showMatches()
    return active
  }

  private func showMatches() {
    var selections: [PDFSelection] = []
    for (index, match) in matches.enumerated() {
      guard case .text(let selection) = match else { continue }
      selection.color = index == active ? .systemOrange : .systemYellow.withAlphaComponent(0.5)
      selections.append(selection)
    }
    pdfView.highlightedSelections = selections.isEmpty ? nil : selections
    guard matches.indices.contains(active) else { return }
    switch matches[active] {
    case .text(let selection):
      pdfView.go(to: selection)
    case .ink(let page, let rect):
      pdfView.go(to: rect, on: page)
      DispatchQueue.main.async { [weak self] in
        guard let self, let document = self.pdfView.documentView else { return }
        let inView = self.pdfView.convert(rect, from: page)
        flash(self.pdfView.convert(inView, to: document), in: document)
      }
    }
  }

  // -- Fitting ------------------------------------------------------------

  /// The width-fitting scale last applied: still showing it means the reader
  /// hasn't zoomed, so a new frame (the sidebar, a rotation) refits.
  private var fitted: CGFloat?

  override func refit(by scale: CGFloat) {
    // The page point at the top of the view stays there, as the zoom eases
    // about the top (PDFKit's own refit scrolls elsewhere).
    let top = CGPoint(x: bounds.midX, y: 0)
    let page = pdfView.page(for: top, nearest: true)
    let point = page.map { pdfView.convert(top, to: $0) }
    layoutIfNeeded()
    pdfView.layoutIfNeeded()
    guard let page, let point,
      let scroll = pdfView.subviews.lazy.compactMap({ $0 as? UIScrollView }).first
    else { return }
    let now = pdfView.convert(point, from: page)
    scroll.contentOffset.y += now.y - top.y
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    guard pdfView.document != nil, bounds.width > 0 else { return }
    let first = fitted == nil
    if first || abs(pdfView.scaleFactor - (fitted ?? 0)) < 0.001 {
      // Setting it again refits; PDFView doesn't on its own once laid out.
      pdfView.autoScales = true
      fitted = pdfView.scaleFactor
    }
    // Opens at the top of the first page, not wherever the first fit left it.
    if first { DispatchQueue.main.async { self.pdfView.goToFirstPage(nil) } }
  }
}

/// What PDFKit gets as a page's overlay: a view the page's size, in page
/// points, which PDFKit scales with its zoom. The canvas inside is `zoom`
/// times bigger, showing the whole page at that zoom (PaperKit's own, which
/// draws sharp), and scaled back down by as much.
final class CanvasHost: UIView {
  private let controller: PaperMarkupViewController
  /// The page, in markup space.
  private let page: CGRect

  var zoom: CGFloat = 1 {
    didSet { if zoom != oldValue { setNeedsLayout() } }
  }

  init(controller: PaperMarkupViewController, page: CGRect) {
    self.controller = controller
    self.page = page
    super.init(frame: CGRect(origin: .zero, size: page.size))
    backgroundColor = .clear
    isOpaque = false
    addSubview(controller.view)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError() }

  override func layoutSubviews() {
    super.layoutSubviews()
    let canvas = controller.view!
    canvas.transform = .identity
    canvas.frame = CGRect(x: 0, y: 0, width: bounds.width * zoom, height: bounds.height * zoom)
    canvas.transform = CGAffineTransform(scaleX: 1 / zoom, y: 1 / zoom)
    canvas.center = CGPoint(x: bounds.midX, y: bounds.midY)
    canvas.layoutIfNeeded()
    // PaperKit's own pinch would zoom the ink apart from the page.
    controller.zoomRange = zoom...zoom
    controller.setContentVisibleFrame(page, animated: false)
  }
}

extension PdfSurface: UIGestureRecognizerDelegate {
  func gestureRecognizer(
    _ gestureRecognizer: UIGestureRecognizer,
    shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer
  ) -> Bool { true }
}

/// PDFView, which keeps text selection for itself outside markup mode (a
/// Pencil dragging over text would select it, not draw). So it's markup mode
/// for each touch of the Pencil, or of a finger with finger drawing on,
/// decided as the touch lands (`TouchKind`): a finger still selects text.
final class MarkupPDFView: PDFView {
  var fingerDraws = false {
    didSet { isInMarkupMode = fingerDraws }
  }

  /// The last touch to land was the Pencil's (`TouchKind`): what drew the
  /// stroke that just ended.
  var pencilLanded: Bool { touchKind.pencil }
  private lazy var touchKind = TouchKind { [weak self] pencil in
    guard let self, !self.fingerDraws, self.isInMarkupMode != pencil else { return }
    self.isInMarkupMode = pencil
  }

  override init(frame: CGRect) {
    super.init(frame: frame)
    addGestureRecognizer(touchKind)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError() }
}

extension Array {
  subscript(safe index: Int) -> Element? { indices.contains(index) ? self[index] : nil }
}
