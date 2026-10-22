import PaperKit
import PencilKit
import SurfaceCore
import Tauri
import UIKit

/// The tools every PDF and drawing shares, as Notes has one set: Solstice's
/// own ribbon and squeeze palette (`components/ink/` on the web side) choose
/// them, and this applies the one in hand (`ToolSpec`) to every canvas. No
/// `PKToolPicker`: its floating palette covered the app.
///
/// The Pencil always draws, from its first touch; a finger scrolls, unless
/// finger drawing is on (`fingerDraws`). The Pencil's double tap and squeeze
/// go to the web side as `pencil` events, which does what Settings asks.
@MainActor
final class Ink: NSObject {
  static let shared = Ink()

  private static let fingerDrawsKey = "solstice.ink.fingerDraws"
  private static let toolKey = "solstice.ink.tool"
  private static let rulerKey = "solstice.ink.ruler"

  /// Where events go (`ink`), and what turns points into the page's CSS pixels.
  weak var plugin: NativePlugin?

  /// The tool in hand. Kept here too, so the Pencil draws with it at launch,
  /// before the web side has said.
  private(set) var spec: ToolSpec = UserDefaults.standard.data(forKey: toolKey)
    .flatMap { try? JSONDecoder().decode(ToolSpec.self, from: $0) } ?? .pen
  private(set) lazy var tool: any PKTool = Self.tool(for: spec)
  private(set) var ruler = UserDefaults.standard.bool(forKey: rulerKey)

  /// A finger draws too, on every surface: the ribbon's toggle, asked for
  /// outright, so it wins over the system's "Only Draw with Apple Pencil".
  private(set) var fingerDraws = UserDefaults.standard.bool(forKey: fingerDrawsKey)

  /// Scribbling over strokes with the Pencil erases them (`Scratcher`): the
  /// `ink.scratchOut` setting, sent from the web side.
  var scratchOut = true

  /// Pages and drawings are shown on dark paper (`ink.darkPaper`, `Paper`).
  /// What's saved is the same either way.
  private(set) var darkPaper = false

  func setDarkPaper(_ on: Bool) {
    guard on != darkPaper else { return }
    darkPaper = on
    PaperPage.dark = on
    for surface in surfaces.allObjects { surface.paperChanged() }
  }

  /// The theme's ground (`--background`, from the web side): what dark paper
  /// is painted with, so drawings and pages take the theme's colour.
  func setPaper(_ rgb: [Double]) {
    guard rgb.count >= 3 else { return }
    let colour = UIColor(
      red: CGFloat(rgb[0]) / 255, green: CGFloat(rgb[1]) / 255, blue: CGFloat(rgb[2]) / 255, alpha: 1)
    guard colour != Paper.ground else { return }
    Paper.ground = colour
    for surface in surfaces.allObjects { surface.paperChanged() }
  }

  /// The surface holding the tools: its canvas is first responder.
  private weak var active: SurfaceView?
  /// The one that last held them, to hand them back to after typing.
  private weak var last: SurfaceView?
  /// Web text has focus.
  private var webFocused = false
  private let surfaces = NSHashTable<SurfaceView>.weakObjects()
  private var undoSent: (Bool, Bool)?

  private override init() {
    super.init()
    let center = NotificationCenter.default
    for name in [Notification.Name.NSUndoManagerDidCloseUndoGroup, .NSUndoManagerDidUndoChange, .NSUndoManagerDidRedoChange] {
      center.addObserver(self, selector: #selector(undoChanged), name: name, object: nil)
    }
  }

  /// The surface the ribbon acts on: the one with the tools, else the last
  /// one shown.
  var current: SurfaceView? {
    active ?? last.flatMap { $0.isShown ? $0 : nil } ?? surfaces.allObjects.first(where: \.isShown)
  }

  func register(_ surface: SurfaceView) {
    surfaces.add(surface)
  }

  // -- The tools ---------------------------------------------------------

  func setTool(_ spec: ToolSpec) {
    guard spec != self.spec else { return }
    self.spec = spec
    tool = Self.tool(for: spec)
    UserDefaults.standard.set(try? JSONEncoder().encode(spec), forKey: Self.toolKey)
    changed()
    surfaceLog.info("tool \(spec.kind.rawValue, privacy: .public) to \(self.surfaces.count) surfaces")
  }

  func setRuler(_ on: Bool) {
    guard on != ruler else { return }
    ruler = on
    UserDefaults.standard.set(on, forKey: Self.rulerKey)
    changed()
  }

  func setFingerDraws(_ on: Bool) {
    guard on != fingerDraws else { return }
    fingerDraws = on
    UserDefaults.standard.set(on, forKey: Self.fingerDrawsKey)
    changed()
    if on, let shown = current { activate(shown) }
  }

  private func changed() {
    for surface in surfaces.allObjects { surface.inkChanged() }
  }

  /// Gives a canvas the tool in hand, the ruler, and whether a finger draws.
  func configure(_ controller: PaperMarkupViewController) {
    controller.drawingTool = tool
    if controller.isRulerActive != ruler {
      controller.isRulerActive = ruler
      // The canvas only shows the ruler once it lays out again.
      controller.view.setNeedsLayout()
      controller.view.layoutIfNeeded()
    }
    // Drawing mode, and the drawing gestures let a finger in (`letFingerDraw`).
    let defaultMode = Self.defaultTouchMode ?? controller.directTouchMode
    Self.defaultTouchMode = defaultMode
    controller.directTouchMode = fingerDraws ? .drawing : defaultMode
    controller.directTouchAutomaticallyDraws = fingerDraws
    Self.letFingerDraw(fingerDraws, in: controller.view)
    controller.scrollConfiguration.scrollsToTop = false
    Self.ignoreStatusBarTap(in: controller.view)
  }

  /// A tap on the status bar scrolls a scroll view to its top, which on a
  /// canvas is a blank band far above what was drawn, and the Pencil's hand
  /// lands there often. No scroll view under `view` answers it.
  static func ignoreStatusBarTap(in view: UIView) {
    for scroll in view.subviews(of: UIScrollView.self) { scroll.scrollsToTop = false }
  }

  /// PaperKit's drawing gestures take only the Pencil, whatever its touch
  /// mode says: with finger drawing on, they take a finger too, and the
  /// canvas scrolls with two fingers, as Notes does.
  static func letFingerDraw(_ on: Bool, in view: UIView) {
    let pencil = UITouch.TouchType.pencil.rawValue as NSNumber
    let direct = UITouch.TouchType.direct.rawValue as NSNumber
    for gesture in view.gestureRecognizersBelow()
    where NSStringFromClass(type(of: gesture)).hasSuffix("DrawingGestureRecognizer") {
      gesture.allowedTouchTypes = on ? [pencil, direct] : [pencil]
    }
    for scroll in view.subviews(of: UIScrollView.self) {
      scroll.panGestureRecognizer.minimumNumberOfTouches = on ? 2 : 1
    }
    // The canvas PaperKit draws through (PencilKit's own, with the public
    // `PKCanvasView.drawingPolicy`): it turns a finger away whatever the
    // gestures take.
    let policy: PKCanvasViewDrawingPolicy = on ? .anyInput : .default
    for canvas in view.descendants where canvas.responds(to: NSSelectorFromString("setDrawingPolicy:")) {
      canvas.setValue(policy.rawValue, forKey: "drawingPolicy")
    }
  }

  /// A canvas's own touch mode, for when finger drawing goes off again.
  private static var defaultTouchMode: PaperMarkupViewController.TouchMode?

  static func tool(for spec: ToolSpec) -> any PKTool {
    switch spec.kind {
    case .eraser:
      return PKEraserTool(spec.eraser == .bitmap ? .bitmap : .vector, width: spec.width)
    case .lasso:
      return PKLassoTool()
    default:
      let type = inkType(spec.kind)
      // Standard range, as the picker was capped (`colorMaximumLinearExposure`):
      // HDR ink has no PDF equivalent.
      let colour = UIColor(red: spec.red, green: spec.green, blue: spec.blue, alpha: spec.opacity)
      let range = type.validWidthRange
      let width = min(max(spec.width, range.lowerBound), range.upperBound)
      return PKInkingTool(type, color: colour, width: width)
    }
  }

  private static func inkType(_ kind: ToolSpec.Kind) -> PKInkingTool.InkType {
    switch kind {
    case .monoline: .monoline
    case .fountainPen: .fountainPen
    case .marker: .marker
    case .pencil: .pencil
    case .crayon: .crayon
    case .watercolor: .watercolor
    case .reed: .reed
    default: .pen
    }
  }

  // -- Undo --------------------------------------------------------------

  func undo() {
    current?.undoTarget?.undo()
    sendUndo()
  }

  func redo() {
    current?.undoTarget?.redo()
    sendUndo()
  }

  @objc private func undoChanged() {
    // After the manager has settled (the notification comes mid-change).
    DispatchQueue.main.async { [weak self] in self?.sendUndo() }
  }

  func sendUndo(force: Bool = false) {
    let manager = current?.undoTarget
    let state = (manager?.canUndo ?? false, manager?.canRedo ?? false)
    if !force, let undoSent, undoSent == state { return }
    undoSent = state
    plugin?.trigger("ink", data: ["type": "undo", "canUndo": state.0, "canRedo": state.1])
  }

  // -- Who holds the tools --------------------------------------------------

  /// Gives `surface` the tools: the Pencil touched it, or it came to the
  /// front. Not while web text has focus, unless the Pencil asked.
  func activate(_ surface: SurfaceView, touched: Bool = false) {
    guard surface.isShown, touched || !webFocused else { return }
    if touched { webFocused = false }
    if active !== surface { active?.dropTools() }
    active = surface
    last = surface
    surface.takeTools()
    sendUndo()
  }

  /// Takes the tools from `surface` (hidden, closing).
  func deactivate(_ surface: SurfaceView) {
    guard active === surface else { return }
    active = nil
    surface.dropTools()
    sendUndo()
  }

  /// A surface was shown or hidden (its tab switched).
  func visibilityChanged(_ surface: SurfaceView) {
    if surface.isShown {
      // After the frame settles: a view can't take first responder mid-layout.
      DispatchQueue.main.async { [weak self, weak surface] in
        guard let self, let surface else { return }
        self.activate(surface)
      }
    } else {
      deactivate(surface)
    }
  }

  /// Web text took or lost focus: typing has the keyboard, the canvas gives
  /// up first responder until the Pencil touches it again.
  func webFocus(_ on: Bool) {
    webFocused = on
    if on {
      active.map(deactivate)
    } else if let shown = current {
      activate(shown)
    }
  }
}

// -- The Pencil's double tap and squeeze ----------------------------------

extension Ink: UIPencilInteractionDelegate {
  /// Listens for the Pencil over the whole app (`view`: the webview's parent),
  /// acting only while a drawing or PDF is shown.
  func listen(in view: UIView) {
    let interaction = UIPencilInteraction(delegate: self)
    view.addInteraction(interaction)
  }

  private var anyShown: Bool { surfaces.allObjects.contains(where: \.isShown) }

  func pencilInteraction(_ interaction: UIPencilInteraction, didReceiveTap tap: UIPencilInteraction.Tap) {
    guard anyShown else { return }
    sendPencil("tap", phase: nil, preference: UIPencilInteraction.preferredTapAction, hover: tap.hoverPose, in: interaction.view)
  }

  func pencilInteraction(_ interaction: UIPencilInteraction, didReceiveSqueeze squeeze: UIPencilInteraction.Squeeze) {
    guard anyShown else { return }
    let phase =
      switch squeeze.phase {
      case .began: "began"
      case .changed: "changed"
      case .ended: "ended"
      default: "cancelled"
      }
    sendPencil(
      "squeeze", phase: phase, preference: UIPencilInteraction.preferredSqueezeAction, hover: squeeze.hoverPose,
      in: interaction.view)
  }

  private func sendPencil(
    _ gesture: String, phase: String?, preference: UIPencilPreferredAction, hover: UIPencilHoverPose?, in view: UIView?
  ) {
    var data: JSObject = ["type": "pencil", "gesture": gesture, "preference": Self.name(preference)]
    if let phase { data["phase"] = phase }
    if let hover, let view, let point = plugin?.cssPoint(hover.location, from: view) {
      data["x"] = Double(point.x)
      data["y"] = Double(point.y)
      // Which way the barrel leans, so the palette opens away from the hand.
      data["azimuth"] = Double(hover.azimuthAngle)
    }
    plugin?.trigger("ink", data: data)
  }

  /// As `PencilPreference` in `lib/ink/toolbox.ts` names it.
  private static func name(_ action: UIPencilPreferredAction) -> String {
    switch action {
    case .switchEraser: "switchEraser"
    case .switchPrevious: "switchPrevious"
    case .showColorPalette: "showColorPalette"
    case .showInkAttributes: "showInkAttributes"
    case .showContextualPalette: "showContextualPalette"
    case .runSystemShortcut: "runSystemShortcut"
    default: "ignore"
    }
  }
}

// -- The full colour picker --------------------------------------------------

extension Ink: UIColorPickerViewControllerDelegate {
  /// Apple's colour picker (spectrum, sliders, eyedropper, opacity) as a
  /// popover from `rect` in `view`, starting on the colour in hand.
  func pickColor(from rect: CGRect, in view: UIView, by presenter: UIViewController) {
    let picker = UIColorPickerViewController()
    picker.supportsAlpha = true
    picker.selectedColor = UIColor(red: spec.red, green: spec.green, blue: spec.blue, alpha: spec.opacity)
    picker.delegate = self
    picker.modalPresentationStyle = .popover
    picker.popoverPresentationController?.sourceView = view
    picker.popoverPresentationController?.sourceRect = rect
    presenter.present(picker, animated: true)
  }

  func colorPickerViewController(
    _ viewController: UIColorPickerViewController, didSelect color: UIColor, continuously: Bool
  ) {
    sendColor(color, final: !continuously)
  }

  func colorPickerViewControllerDidFinish(_ viewController: UIColorPickerViewController) {
    sendColor(viewController.selectedColor, final: true)
  }

  private func sendColor(_ color: UIColor, final: Bool) {
    var (r, g, b, a): (CGFloat, CGFloat, CGFloat, CGFloat) = (0, 0, 0, 1)
    // In sRGB, clamped: the picker can hand back extended colours.
    let srgb = color.cgColor.converted(to: CGColorSpace(name: CGColorSpace.sRGB)!, intent: .defaultIntent, options: nil)
    UIColor(cgColor: srgb ?? color.cgColor).getRed(&r, green: &g, blue: &b, alpha: &a)
    let hex = ToolSpec(kind: .pen, red: r, green: g, blue: b, width: 1, opacity: 1, eraser: .vector).hex
    plugin?.trigger("ink", data: ["type": "color", "color": hex, "opacity": Double(a), "final": final])
  }
}

extension UIView {
  /// Every gesture recognizer on this view and the views under it.
  func gestureRecognizersBelow() -> [UIGestureRecognizer] {
    (gestureRecognizers ?? []) + subviews.flatMap { $0.gestureRecognizersBelow() }
  }

  /// Every view under this one.
  var descendants: [UIView] { subviews.flatMap { [$0] + $0.descendants } }

  /// Every view of `type` under this one.
  func subviews<T: UIView>(of type: T.Type) -> [T] {
    subviews.flatMap { view -> [T] in
      if let match = view as? T { return [match] }
      return view.subviews(of: type)
    }
  }
}
