import PencilKit
import UIKit

/// The tools every PDF and drawing shares, as Notes has one picker: the
/// tool, colour and width carry from file to file and across launches. One
/// place to drive the tools from, should Solstice draw its own palette.
///
/// The Pencil always draws, from its first touch; a finger scrolls, unless
/// finger drawing is on (the Draw button, `fingerDraws`). The tool picker
/// shows on the surface in front (`active`), so squeeze and double-tap work
/// there, and goes while web text has focus: typing wins, in a split too.
@MainActor
final class Ink: NSObject {
  static let shared = Ink()

  let picker = PKToolPicker()
  private static let fingerDrawsKey = "solstice.ink.fingerDraws"

  /// A finger draws too, on every surface. The system's "Only Draw with
  /// Apple Pencil" still wins.
  private(set) var fingerDraws = UserDefaults.standard.bool(forKey: fingerDrawsKey)
  var fingerDrawsNow: Bool { fingerDraws && !UIPencilInteraction.prefersPencilOnlyDrawing }

  /// Scribbling over strokes with the Pencil erases them (`Scratcher`): the
  /// `ink.scratchOut` setting, sent from the web side.
  var scratchOut = true

  /// The surface holding the tools: its canvas is first responder.
  private weak var active: SurfaceView?
  /// The one that last held them, to hand them back to after typing.
  private weak var last: SurfaceView?
  /// Web text has focus.
  private var webFocused = false
  private let surfaces = NSHashTable<SurfaceView>.weakObjects()

  private override init() {
    super.init()
    picker.stateAutosaveName = "solstice.ink"
    // The canvases are paper, always light: in dark mode the swatches would
    // otherwise show black ink as white.
    picker.colorUserInterfaceStyle = .light
  }

  /// The tool in hand, for a canvas just made.
  var tool: any PKTool { picker.selectedToolItem.tool ?? PKInkingTool(.pen) }

  func register(_ surface: SurfaceView) {
    surfaces.add(surface)
    surface.send("editing", ["on": fingerDraws])
  }

  func setFingerDraws(_ on: Bool) {
    guard on != fingerDraws else { return }
    fingerDraws = on
    UserDefaults.standard.set(on, forKey: Self.fingerDrawsKey)
    for surface in surfaces.allObjects {
      surface.inkChanged()
      surface.send("editing", ["on": on])
    }
    if on, let shown = last ?? surfaces.allObjects.first(where: \.isShown) { activate(shown) }
  }

  /// Gives `surface` the tools: the Pencil touched it, or it came to the
  /// front. Not while web text has focus, unless the Pencil asked.
  func activate(_ surface: SurfaceView, touched: Bool = false) {
    guard surface.isShown, touched || !webFocused else { return }
    if touched { webFocused = false }
    if active !== surface { active?.dropTools() }
    active = surface
    last = surface
    picker.accessoryItem = UIBarButtonItem(
      image: UIImage(systemName: "plus.circle"),
      primaryAction: UIAction { [weak surface] _ in surface?.showInsertMenu() })
    surface.takeTools()
  }

  /// Takes the tools from `surface` (hidden, closing).
  func deactivate(_ surface: SurfaceView) {
    guard active === surface else { return }
    active = nil
    surface.dropTools()
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

  /// Web text took or lost focus.
  func webFocus(_ on: Bool) {
    webFocused = on
    if on {
      active.map(deactivate)
    } else if let shown = last.flatMap({ $0.isShown ? $0 : nil }) ?? surfaces.allObjects.first(where: \.isShown) {
      activate(shown)
    }
  }
}
