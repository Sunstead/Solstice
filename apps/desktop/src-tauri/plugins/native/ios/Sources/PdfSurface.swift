import PDFKit
import PaperKit
import PencilKit
import Tauri
import UIKit

/// A PDF, in PDFKit (Apple's scrolling, zoom and text selection), marked up
/// with PaperKit as in Preview and Files: a markup canvas over each page, the
/// system tool picker, and the marks written into the PDF itself
/// (`PdfMarkup`), so every device and every reader shows them.
final class PdfSurface: SurfaceView, PDFPageOverlayViewProvider, PaperMarkupViewController.Delegate {
  /// Everything PaperKit offers, in standard range: a page is printed paper,
  /// and HDR ink has no PDF equivalent.
  private static let features: FeatureSet = {
    var features = FeatureSet.latest
    features.colorMaximumLinearExposure = 1
    return features
  }()

  private let pdfView = PDFView()
  private let toolPicker = PKToolPicker()
  /// The canvas over each page PDFKit is showing (or that has unsaved marks).
  private var canvases: [ObjectIdentifier: (page: PDFPage, controller: PaperMarkupViewController)] = [:]
  private var unsaved = Set<ObjectIdentifier>()
  /// Pages added: the file needs writing even with no new marks.
  private var pagesChanged = false
  private var editing = false
  private var saveTask: Task<Void, Never>?
  /// When we last wrote the file, so our own save isn't taken for a change.
  private var written: Date?

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
    addSubview(pdfView)

    // Squeeze, barrel roll and the + menu come with Apple's tool picker.
    toolPicker.accessoryItem = UIBarButtonItem(
      image: UIImage(systemName: "plus.circle"),
      primaryAction: UIAction { [weak self] _ in self?.showInsertMenu() })
    pencilKitResponderState.activeToolPicker = toolPicker
    pencilKitResponderState.toolPickerVisibility = .hidden

    // The Pencil on the page starts marking up, as in Preview.
    let pencil = UILongPressGestureRecognizer(target: self, action: #selector(pencilDown(_:)))
    pencil.minimumPressDuration = 0
    pencil.allowedTouchTypes = [UITouch.TouchType.pencil.rawValue as NSNumber]
    pencil.cancelsTouchesInView = false
    pencil.delegate = self
    pdfView.addGestureRecognizer(pencil)

    load()
  }

  private func load() {
    let url = URL(fileURLWithPath: path)
    guard let document = PDFDocument(url: url) else {
      send("error", ["message": "Couldn't open this PDF."])
      return
    }
    // The page canvases draw Solstice's marks; the copies in the file are
    // for other readers.
    for index in 0..<document.pageCount {
      if let page = document.page(at: index) { PdfMarkup.showCopies(false, on: page) }
    }
    dropCanvases()
    pdfView.document = document
  }

  override func reload() {
    // Our own save, or marks not yet saved: ours win (the sync keeps the
    // other version beside it if both changed).
    let modified = try? FileManager.default.attributesOfItem(atPath: path)[.modificationDate] as? Date
    if !unsaved.isEmpty || pagesChanged || (written != nil && modified == written) { return }

    // Back to the same page, and the same zoom if the reader had zoomed.
    let page = pdfView.currentPage.flatMap { pdfView.document?.index(for: $0) }
    let scale = pdfView.scaleFactor
    let zoomed = fitted.map { abs(scale - $0) >= 0.001 } ?? false
    load()
    if zoomed {
      pdfView.scaleFactor = scale
    } else {
      pdfView.autoScales = true
      fitted = pdfView.scaleFactor
    }
    if let page, let target = pdfView.document?.page(at: page) { pdfView.go(to: target) }
  }

  // -- Markup ------------------------------------------------------------

  func pdfView(_ view: PDFView, overlayViewFor page: PDFPage) -> UIView? {
    let key = ObjectIdentifier(page)
    if let existing = canvases[key] { return existing.controller.view }

    let size = page.bounds(for: .cropBox).size
    var markup = PdfMarkup.read(page) ?? PaperMarkup(bounds: CGRect(origin: .zero, size: size))
    // The page shows through: PaperKit's canvas is otherwise white paper.
    markup.backgroundColor = UIColor.clear.cgColor
    let controller = PaperMarkupViewController(markup: markup, supportedFeatureSet: Self.features)
    controller.delegate = self
    // A page is paper: ink keeps its colour, where dark mode would turn
    // black ink white.
    controller.overrideUserInterfaceStyle = .light
    controller.loadViewIfNeeded()
    clear(controller.view)
    controller.scrollConfiguration.isScrollEnabled = false
    configure(controller)
    toolPicker.addObserver(controller)
    if let parent = plugin?.manager.viewController {
      parent.addChild(controller)
      controller.didMove(toParent: parent)
    }
    canvases[key] = (page, controller)
    observeMarkup(of: controller) { [weak self, weak controller] in
      guard let self, let controller, self.canvases[key]?.controller === controller else { return }
      self.paperMarkupViewControllerDidChangeMarkup(controller)
    }
    return controller.view
  }

  func pdfView(_ pdfView: PDFView, willEndDisplayingOverlayView overlayView: UIView, for page: PDFPage) {
    // Kept until saved when it has unsaved marks.
    let key = ObjectIdentifier(page)
    if !unsaved.contains(key) { dropCanvas(key) }
  }

  private func clear(_ view: UIView) {
    view.backgroundColor = .clear
    view.isOpaque = false
    view.subviews.forEach(clear)
  }

  private func configure(_ controller: PaperMarkupViewController) {
    controller.isEditable = editing
    controller.view.isUserInteractionEnabled = editing
    // A finger draws too while marking up, unless the system says Pencil only.
    controller.directTouchAutomaticallyDraws = editing && !UIPencilInteraction.prefersPencilOnlyDrawing
  }

  override func setEditing(_ on: Bool) {
    guard on != editing else { return }
    editing = on
    pdfView.isInMarkupMode = on
    canvases.values.forEach { configure($0.controller) }
    pencilKitResponderState.toolPickerVisibility = on ? .visible : .hidden
    if on {
      current?.becomeFirstResponder()
    } else {
      current?.resignFirstResponder()
      flush()
    }
    send("editing", ["on": on])
  }

  /// The canvas of the page in view.
  private var current: PaperMarkupViewController? {
    guard let page = pdfView.currentPage else { return canvases.values.first?.controller }
    return canvases[ObjectIdentifier(page)]?.controller
  }

  @objc private func pencilDown(_ gesture: UILongPressGestureRecognizer) {
    if gesture.state == .began, !editing { setEditing(true) }
  }

  private func showInsertMenu() {
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
      let page = Notebook.page(
        template: Notebook.template(of: document), size: CGRect(origin: .zero, size: size.size))
    else { return }
    let after = pdfView.currentPage.map { document.index(for: $0) } ?? document.pageCount - 1
    document.insert(page, at: after + 1)
    pdfView.go(to: page)
    pagesChanged = true
    scheduleSave()
  }

  func paperMarkupViewControllerDidChangeMarkup(_ controller: PaperMarkupViewController) {
    guard let entry = canvases.first(where: { $0.value.controller === controller }) else { return }
    unsaved.insert(entry.key)
    scheduleSave()
  }

  private func scheduleSave() {
    send("dirty")
    saveTask?.cancel()
    saveTask = Task { @MainActor [weak self] in
      try? await Task.sleep(for: .seconds(1))
      guard !Task.isCancelled else { return }
      await self?.save()
    }
  }

  // -- Saving ------------------------------------------------------------

  override func flush(_ done: @escaping () -> Void = {}) {
    saveTask?.cancel()
    Task { @MainActor in
      await self.save()
      done()
    }
  }

  /// Writes the changed pages' marks into the PDF, through a temporary file
  /// so nothing ever reads half a PDF.
  private func save() async {
    guard let document = pdfView.document, !unsaved.isEmpty || pagesChanged else { return }
    let pages = unsaved.compactMap { canvases[$0] }
    unsaved.removeAll()
    pagesChanged = false

    for (page, controller) in pages {
      guard let markup = controller.markup else { continue }
      do {
        try await PdfMarkup.write(markup, to: page)
      } catch {
        send("error", ["message": "Couldn't save the markup: \(error.localizedDescription)"])
      }
    }

    let url = URL(fileURLWithPath: path)
    let temporary = url.deletingLastPathComponent()
      .appendingPathComponent(".\(url.lastPathComponent).saving")
    var saved = false
    if document.write(to: temporary) {
      saved = (try? FileManager.default.replaceItemAt(url, withItemAt: temporary)) != nil
    }
    for (page, _) in pages { PdfMarkup.showCopies(false, on: page) }
    if saved {
      written = try? FileManager.default.attributesOfItem(atPath: path)[.modificationDate] as? Date
      send("saved")
    } else {
      try? FileManager.default.removeItem(at: temporary)
      for (page, _) in pages { unsaved.insert(ObjectIdentifier(page)) }
      pagesChanged = true
      send("error", ["message": "Couldn't save this PDF."])
    }
    // Canvases scrolled away while unsaved can go now.
    for (page, _) in pages where !pdfView.visiblePages.contains(page) {
      dropCanvas(ObjectIdentifier(page))
    }
  }

  private func dropCanvas(_ key: ObjectIdentifier) {
    guard let entry = canvases.removeValue(forKey: key) else { return }
    toolPicker.removeObserver(entry.controller)
    entry.controller.willMove(toParent: nil)
    entry.controller.removeFromParent()
  }

  private func dropCanvases() {
    canvases.keys.forEach(dropCanvas)
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
      let markup = canvases[ObjectIdentifier(page)]?.controller.markup ?? PdfMarkup.read(page)
      if let markup {
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

extension PdfSurface: UIGestureRecognizerDelegate {
  func gestureRecognizer(
    _ gestureRecognizer: UIGestureRecognizer,
    shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer
  ) -> Bool { true }
}
