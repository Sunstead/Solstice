import PDFKit
import PaperKit
import PencilKit
import SurfaceCore
import Tauri
import UIKit
import os

/// A PDF, in PDFKit (Apple's scrolling, zoom and text selection), marked up
/// with PaperKit as in Preview and Files: a markup canvas over each page, the
/// system tool picker, and the marks written into the PDF itself
/// (`PdfMarkup`, `PdfStore`), so every device and every reader shows them.
///
/// The Pencil draws from its first touch; a finger scrolls, zooms and
/// selects text, or draws too with finger drawing on (`Ink`).
final class PdfSurface: SurfaceView, PDFPageOverlayViewProvider, PaperMarkupViewController.Delegate {
  /// Everything PaperKit offers, in standard range: a page is printed paper,
  /// and HDR ink has no PDF equivalent.
  private static let features: FeatureSet = {
    var features = FeatureSet.latest
    features.colorMaximumLinearExposure = 1
    return features
  }()
  private static let signposts = OSSignposter(subsystem: "app.solstice", category: "PdfSurface")

  private let pdfView = MarkupPDFView()
  private var toolPicker: PKToolPicker { Ink.shared.picker }
  /// The canvas over each page PDFKit is showing (or that has unsaved marks).
  private var canvases:
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
    pdfView.fingerDraws = Ink.shared.fingerDrawsNow
    addSubview(pdfView)

    // Squeeze, barrel roll and the + menu come with Apple's tool picker.
    pencilKitResponderState.activeToolPicker = toolPicker
    pencilKitResponderState.toolPickerVisibility = .hidden

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
      guard let document = PDFDocument(url: URL(fileURLWithPath: path)) else {
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
    }
    dropCanvases()
    pdfView.document = document
    if opened?.needsRepair == true {
      repairing = true
      scheduleSave(after: .zero)
    }
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
    if let existing = canvases[key] { return existing.host }

    let size = page.bounds(for: .cropBox).size
    var markup = marks(of: page) ?? PaperMarkup(bounds: CGRect(origin: .zero, size: size))
    // The page shows through: PaperKit's canvas is otherwise white paper.
    markup.backgroundColor = UIColor.clear.cgColor
    let controller = PaperMarkupViewController(markup: markup, supportedFeatureSet: Self.features)
    controller.delegate = self
    // A page is paper: ink keeps its colour, where dark mode would turn
    // black ink white.
    controller.overrideUserInterfaceStyle = .light
    // Made before it's in a window, the canvas would draw at 1x.
    controller.traitOverrides.displayScale = displayScale
    controller.loadViewIfNeeded()
    clear(controller.view)
    controller.scrollConfiguration.isScrollEnabled = false
    controller.zoomRange = 0.1...Self.maximumZoom
    controller.isEditable = true
    controller.drawingTool = Ink.shared.tool
    configure(controller)
    toolPicker.addObserver(controller)
    if let parent = plugin?.manager.viewController {
      parent.addChild(controller)
      controller.didMove(toParent: parent)
    }
    let host = CanvasHost(controller: controller, page: CGRect(origin: .zero, size: size))
    host.zoom = zoom
    canvases[key] = (page, controller, host)
    scratchers[key] = Scratcher(markup)
    observeMarkup(of: controller) { [weak self, weak controller] in
      guard let self, let controller, self.canvases[key]?.controller === controller else { return }
      self.paperMarkupViewControllerDidChangeMarkup(controller)
    }
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
    if !unsaved.contains(key) { dropCanvas(key) }
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

  /// The zoom the canvases draw at: PDFKit's.
  private var zoom: CGFloat { min(max(pdfView.scaleFactor, 0.1), Self.maximumZoom) }

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

  private func configure(_ controller: PaperMarkupViewController) {
    controller.directTouchAutomaticallyDraws = Ink.shared.fingerDrawsNow
  }

  override func inkChanged() {
    pdfView.fingerDraws = Ink.shared.fingerDrawsNow
    canvases.values.forEach { configure($0.controller) }
  }

  override func takeTools() {
    pencilKitResponderState.toolPickerVisibility = .visible
    current?.becomeFirstResponder()
  }

  override func dropTools() {
    pencilKitResponderState.toolPickerVisibility = .hidden
    canvases.values.forEach { $0.controller.resignFirstResponder() }
    flush()
  }

  /// The canvas of the page in view.
  private var current: PaperMarkupViewController? {
    guard let page = pdfView.currentPage else { return canvases.values.first?.controller }
    return canvases[ObjectIdentifier(page)]?.controller
  }

  @objc private func pencilDown(_ gesture: UILongPressGestureRecognizer) {
    guard gesture.state == .began else { return }
    Ink.shared.activate(self, touched: true)
    // The page under the Pencil holds the tools, so the picker stays.
    let point = gesture.location(in: pdfView)
    if let page = pdfView.page(for: point, nearest: true),
      let controller = canvases[ObjectIdentifier(page)]?.controller, !controller.isFirstResponder
    {
      controller.becomeFirstResponder()
    }
  }

  @objc private func pageChanged() {
    // A new page in view: its canvas takes the tools, if this has them.
    guard pencilKitResponderState.toolPickerVisibility == .visible, let current, !current.isFirstResponder
    else { return }
    current.becomeFirstResponder()
  }

  override func showInsertMenu() {
    guard let controller = current, let parent = plugin?.manager.viewController else { return }
    let addPage = UIAction(title: "Add Page", image: UIImage(systemName: "doc.badge.plus")) {
      [weak self] _ in self?.addPage()
    }
    let menu = MarkupEditViewController(supportedFeatureSet: Self.features, additionalActions: [addPage])
    menu.delegate = controller
    menu.modalPresentationStyle = .popover
    menu.popoverPresentationController?.sourceItem = toolPicker.accessoryItem
    parent.present(menu, animated: true)
  }

  /// A page after the one in view, with the document's background (a
  /// notebook's), the size of its last page.
  private func addPage() {
    guard let document = pdfView.document else { return }
    let size = document.page(at: document.pageCount - 1)?.bounds(for: .cropBox) ?? Notebook.a4
    guard
      let data = Notebook.pageData(
        template: Notebook.template(of: document), size: CGRect(origin: .zero, size: size.size)),
      let page = PDFDocument(data: data)?.page(at: 0)
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
    scratchers[entry.key]?.check(controller, pencil: pdfView.pencilLanded)
    unsaved.insert(entry.key)
    scheduleSave()
  }

  private func scheduleSave(after wait: Duration = .seconds(1)) {
    send("dirty")
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
      done()
    }
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

    // Taken all at once, so page numbers and added pages agree.
    let pages = unsaved.compactMap { key in
      canvases[key].map { (key: key, page: $0.page, controller: $0.controller, index: document.index(for: $0.page)) }
    }
    let inserts = self.inserts
    let repairing = self.repairing
    unsaved.removeAll()
    self.inserts.removeAll()
    self.repairing = false

    var saved = false
    if encrypted {
      saved = await writeWithPDFKit(document, pages.map { ($0.page, $0.controller) })
    } else {
      var request = PdfStore.Request(inserts: inserts)
      do {
        let collect = Self.signposts.beginInterval("collect")
        for entry in pages {
          guard let markup = entry.controller.markup else { continue }
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
      if !encrypted { for entry in pages { appleInks[entry.key] = nil } }
      send("saved")
    } else {
      // Kept to try again with the next change.
      for entry in pages { unsaved.insert(entry.key) }
      self.inserts = inserts + self.inserts
    }
    // Canvases scrolled away while unsaved can go now.
    for entry in pages where !unsaved.contains(entry.key) && !pdfView.visiblePages.contains(entry.page) {
      dropCanvas(entry.key)
    }
  }

  private func writeWithPDFKit(_ document: PDFDocument, _ pages: [(PDFPage, PaperMarkupViewController)]) async -> Bool {
    for (page, controller) in pages {
      guard let markup = controller.markup else { continue }
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
    scratchers[key] = nil
    if keep, let markup = entry.controller.markup { cached[key] = markup }
    toolPicker.removeObserver(entry.controller)
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
