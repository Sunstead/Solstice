import PaperKit
import PencilKit
import Tauri
import UIKit

/// An infinite drawing (`*.drawing.svg`), as in Freeform: one PaperKit
/// canvas you pan and zoom, Apple's tool picker, the Pencil starting to draw
/// by itself. Saved as an SVG (`DrawingFile`) whose markup is read back here.
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
  private let toolPicker = PKToolPicker()
  private var editing = false
  private var unsaved = false
  private var saveTask: Task<Void, Never>?
  private var written: Date?

  override init(id: String, path: String, plugin: NativePlugin) {
    super.init(id: id, path: path, plugin: plugin)
    toolPicker.accessoryItem = UIBarButtonItem(
      image: UIImage(systemName: "plus.circle"),
      primaryAction: UIAction { [weak self] _ in self?.showInsertMenu() })
    pencilKitResponderState.activeToolPicker = toolPicker
    pencilKitResponderState.toolPickerVisibility = .hidden

    let pencil = UILongPressGestureRecognizer(target: self, action: #selector(pencilDown(_:)))
    pencil.minimumPressDuration = 0
    pencil.allowedTouchTypes = [UITouch.TouchType.pencil.rawValue as NSNumber]
    pencil.cancelsTouchesInView = false
    pencil.delegate = self
    addGestureRecognizer(pencil)

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
    controller.overrideUserInterfaceStyle = .light
    controller.view.frame = bounds
    controller.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    controller.view.backgroundColor = .white
    controller.zoomRange = 0.1...8
    configure(controller)
    toolPicker.addObserver(controller)
    if let parent = plugin?.manager.viewController {
      parent.addChild(controller)
      addSubview(controller.view)
      controller.didMove(toParent: parent)
    } else {
      addSubview(controller.view)
    }
    self.controller = controller
    observeMarkup(of: controller) { [weak self, weak controller] in
      guard let self, let controller, self.controller === controller else { return }
      self.paperMarkupViewControllerDidChangeMarkup(controller)
    }
    opening = markup
    setNeedsLayout()
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

  override func reload() {
    let modified = try? FileManager.default.attributesOfItem(atPath: path)[.modificationDate] as? Date
    if unsaved || (written != nil && modified == written) { return }
    load()
  }

  // -- Editing ------------------------------------------------------------

  private func configure(_ controller: PaperMarkupViewController) {
    controller.isEditable = editing
    controller.directTouchAutomaticallyDraws = editing && !UIPencilInteraction.prefersPencilOnlyDrawing
  }

  override func setEditing(_ on: Bool) {
    guard on != editing, let controller else { return }
    editing = on
    configure(controller)
    pencilKitResponderState.toolPickerVisibility = on ? .visible : .hidden
    if on {
      controller.becomeFirstResponder()
    } else {
      controller.resignFirstResponder()
      flush()
    }
    send("editing", ["on": on])
  }

  @objc private func pencilDown(_ gesture: UILongPressGestureRecognizer) {
    if gesture.state == .began, !editing { setEditing(true) }
  }

  private func showInsertMenu() {
    guard let controller, let parent = plugin?.manager.viewController else { return }
    let menu = MarkupEditViewController(supportedFeatureSet: Self.features)
    menu.delegate = controller
    menu.modalPresentationStyle = .popover
    menu.popoverPresentationController?.sourceItem = toolPicker.accessoryItem
    parent.present(menu, animated: true)
  }

  func paperMarkupViewControllerDidChangeMarkup(_ controller: PaperMarkupViewController) {
    unsaved = true
    send("dirty")
    saveTask?.cancel()
    saveTask = Task { @MainActor [weak self] in
      try? await Task.sleep(for: .seconds(1))
      guard !Task.isCancelled else { return }
      await self?.save()
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
    saveTask?.cancel()
    Task { @MainActor in
      await self.save()
      done()
    }
  }

  private func save() async {
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
      let url = URL(fileURLWithPath: path)
      let temporary = url.deletingLastPathComponent()
        .appendingPathComponent(".\(url.lastPathComponent).saving")
      try svg.write(to: temporary, atomically: false, encoding: .utf8)
      _ = try FileManager.default.replaceItemAt(url, withItemAt: temporary)
      written = try? FileManager.default.attributesOfItem(atPath: path)[.modificationDate] as? Date
      send("saved")
    } catch {
      unsaved = true
      send("error", ["message": "Couldn't save this drawing: \(error.localizedDescription)"])
    }
  }

  private func drop(_ controller: PaperMarkupViewController) {
    toolPicker.removeObserver(controller)
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
