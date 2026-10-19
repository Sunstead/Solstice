import CryptoKit
import ImageIO
import PaperKit
import PencilKit
import SurfaceCore
import UniformTypeIdentifiers
import UIKit

/// A bitmap (PNG, JPEG, HEIC) marked up in place, as Preview does: one
/// PaperKit canvas the size of the image, the image itself its bottom layer,
/// locked, and the marks over it. Saving flattens them into the file, in its
/// own format and size, so every app shows them; while it's open the marks
/// stay marks (undo, move, erase), each save drawing them afresh over the
/// image as it was opened.
final class ImageSurface: SurfaceView, PaperMarkupViewController.Delegate {
  private static let features: FeatureSet = {
    var features = FeatureSet.latest
    features.colorMaximumLinearExposure = 1
    return features
  }()

  private var controller: PaperMarkupViewController?
  private var hasTools = false
  /// The image as opened, in pixels: what each save draws the marks over.
  private var original: CGImage?
  /// The marks drawn since it was opened (the image layer aside).
  private var marked = false
  private var unsaved = false
  private var pendingSave: Task<Void, Never>?
  private let saves = Saves()
  /// What we last wrote, so our own save isn't taken for a change.
  private var written: String?
  private var drewAt: Date?
  private let touchKind = TouchKind { _ in }
  private var scratcher: Scratcher?
  /// The markup just loaded, until the surface has a size to fit it to.
  private var opening: PaperMarkup?


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
    guard let image = Self.read(path) else {
      send("error", ["message": "Couldn't open this image."])
      return
    }
    original = image
    marked = false
    let imageFrame = CGRect(x: 0, y: 0, width: image.width, height: image.height)
    var markup = PaperMarkup(bounds: imageFrame)
    markup.backgroundColor = UIColor.clear.cgColor
    // The image, locked under the marks: drawn, never selected or erased.
    markup.subelements.append(ImageMarkup(image: image, frame: imageFrame, allowedInteractions: []))

    controller.map(drop)
    let controller = PaperMarkupViewController(markup: markup, supportedFeatureSet: Self.features)
    controller.delegate = self
    controller.view.frame = bounds
    controller.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    controller.view.backgroundColor = .clear
    // Ink in its true colours, as it'll be saved: an image has no dark paper,
    // and a dark canvas would swap the ink's lightness (`Paper`).
    controller.overrideUserInterfaceStyle = .light
    controller.zoomRange = 0.02...8
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
    if hasTools { DispatchQueue.main.async { controller.becomeFirstResponder() } }
  }

  /// The fit last made: for the surface's size then, showing `frame`. Refitted
  /// when the size changes (it does as the tab settles), unless moved since.
  private var fit: (size: CGSize, frame: CGRect)?

  override func layoutSubviews() {
    super.layoutSubviews()
    guard let controller, let image = controller.markup?.bounds, bounds.width > 0, bounds.height > 0 else { return }
    if opening != nil {
      opening = nil
      fit = nil
    }
    if let fit {
      let moved = !controller.contentVisibleFrame.insetBy(dx: -1, dy: -1).contains(fit.frame)
        || controller.contentVisibleFrame.width > fit.frame.width + 2
      guard fit.size != bounds.size, !moved else { return }
    }
    // The whole image in view, its shape kept.
    let scale = max(image.width / bounds.width, image.height / bounds.height)
    let frame = CGRect(
      x: image.midX - bounds.width * scale / 2, y: image.midY - bounds.height * scale / 2,
      width: bounds.width * scale, height: bounds.height * scale)
    controller.view.layoutIfNeeded()
    controller.setContentVisibleFrame(frame, animated: false)
    fit = (bounds.size, controller.contentVisibleFrame)
  }

  /// The image in `path`, upright, in pixels.
  private static func read(_ path: String) -> CGImage? {
    guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil) else { return nil }
    // Upright as it's shown everywhere (EXIF orientation applied), and saved so.
    let options: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceThumbnailMaxPixelSize: Self.largestSide(source),
    ]
    return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
  }

  private static func largestSide(_ source: CGImageSource) -> Int {
    let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
    let width = properties?[kCGImagePropertyPixelWidth] as? Int ?? 4096
    let height = properties?[kCGImagePropertyPixelHeight] as? Int ?? 4096
    return max(width, height)
  }

  // -- Editing --------------------------------------------------------------

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

  override func insert(_ item: String, shape: String?) {
    guard let controller else { return }
    let visible = controller.contentVisibleFrame
    MarkupInsert.insert(
      item, shape: shape, into: controller, features: Self.features, centre: CGPoint(x: visible.midX, y: visible.midY),
      presenter: plugin?.manager.viewController)
  }

  @objc private func pencilDown(_ gesture: UILongPressGestureRecognizer) {
    if gesture.state == .began { Ink.shared.activate(self, touched: true) }
  }

  func paperMarkupViewControllerDidBeginDrawing(_ controller: PaperMarkupViewController) {
    drewAt = Date()
  }

  func paperMarkupViewControllerDidChangeMarkup(_ controller: PaperMarkupViewController) {
    scratcher?.check(controller, pencil: touchKind.pencil)
    marked = true
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

  // -- Saving ---------------------------------------------------------------

  private var busy: Bool {
    unsaved || pendingSave != nil || saves.running || drewAt.map { -$0.timeIntervalSinceNow < 5 } ?? false
  }

  override func reload() {
    guard !busy else { return }
    Task { @MainActor [weak self] in
      guard let self else { return }
      if let written = self.written, await PdfStore.hash(self.path) == written { return }
      guard !self.busy else { return }
      self.load()
    }
  }

  override func flush(_ done: @escaping () -> Void = {}) {
    pendingSave?.cancel()
    pendingSave = nil
    Task { @MainActor in
      await self.save()
      done()
    }
  }

  private func save() async {
    await saves.run { [weak self] in
      guard let self, self.unsaved else { return }
      await self.write()
    }
  }

  private func write() async {
    guard unsaved, marked, let controller, let markup = controller.markup, let original else { return }
    unsaved = false
    guard let flattened = await Self.flatten(markup, size: CGSize(width: original.width, height: original.height)),
      let data = Self.encode(flattened, like: path)
    else {
      unsaved = true
      send("error", ["message": "Couldn't save the marks into this image."])
      return
    }
    let path = self.path
    do {
      written = try await Task.detached(priority: .userInitiated) {
        let url = URL(fileURLWithPath: path)
        let temporary = url.deletingLastPathComponent().appendingPathComponent(".\(url.lastPathComponent).saving")
        try data.write(to: temporary)
        _ = try FileManager.default.replaceItemAt(url, withItemAt: temporary)
        return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
      }.value
      send("saved")
    } catch {
      unsaved = true
      send("error", ["message": "Couldn't save this image: \(error.localizedDescription)"])
    }
  }

  /// The image and the marks on it as one picture, `size` in pixels, as
  /// PaperKit draws them in their true colours.
  static func flatten(_ markup: PaperMarkup, size: CGSize) async -> CGImage? {
    let width = Int(size.width)
    let height = Int(size.height)
    guard width > 0, height > 0,
      let context = CGContext(
        data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { return nil }
    // Markup space is y down; PaperKit draws in it whatever the frame.
    context.translateBy(x: 0, y: size.height)
    context.scaleBy(x: size.width / markup.bounds.width, y: -size.height / markup.bounds.height)
    await markup.draw(in: context, frame: markup.bounds, options: RenderingOptions(darkUserInterfaceStyle: false))
    return context.makeImage()
  }

  /// `image` in the format `path` names (PNG, JPEG, HEIC).
  static func encode(_ image: CGImage, like path: String) -> Data? {
    let type: UTType =
      switch (path as NSString).pathExtension.lowercased() {
      case "jpg", "jpeg": .jpeg
      case "heic": .heic
      default: .png
      }
    let data = NSMutableData()
    guard let destination = CGImageDestinationCreateWithData(data as CFMutableData, type.identifier as CFString, 1, nil)
    else { return nil }
    let options: [CFString: Any] = [kCGImageDestinationLossyCompressionQuality: 0.92]
    CGImageDestinationAddImage(destination, image, options as CFDictionary)
    return CGImageDestinationFinalize(destination) ? data as Data : nil
  }

  private func drop(_ controller: PaperMarkupViewController) {
    controller.willMove(toParent: nil)
    controller.view.removeFromSuperview()
    controller.removeFromParent()
  }
}

extension ImageSurface: UIGestureRecognizerDelegate {
  func gestureRecognizer(
    _ gestureRecognizer: UIGestureRecognizer,
    shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer
  ) -> Bool { true }
}
