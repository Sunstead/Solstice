import PencilKit
import UIKit

/// The tool picker every PDF and drawing shares, as Notes has one: the tool,
/// colour and width carry from file to file and across launches. One place
/// to drive the tools from, should Solstice draw its own palette.
@MainActor
final class Ink: NSObject, PKToolPickerObserver {
  static let shared = Ink()

  let picker = PKToolPicker()
  /// The drawing tool last in hand (pen, pencil, marker...).
  private var lastInking: String?

  private override init() {
    super.init()
    picker.stateAutosaveName = "solstice.ink"
    picker.addObserver(self)
    remember()
  }

  /// The + button beside the tools, for the surface being marked up.
  func accessory(_ action: @escaping () -> Void) {
    picker.accessoryItem = UIBarButtonItem(
      image: UIImage(systemName: "plus.circle"),
      primaryAction: UIAction { _ in action() })
  }

  /// The Pencil touching a page starts marking up with a drawing tool, never
  /// the eraser or lasso left from last time.
  func penInHand() {
    guard !(picker.selectedToolItem is PKToolPickerInkingItem) else { return }
    let inking = picker.toolItems.filter { $0 is PKToolPickerInkingItem }.map(\.identifier)
    if let id = lastInking.flatMap({ inking.contains($0) ? $0 : nil }) ?? inking.first {
      picker.selectedToolItemIdentifier = id
    }
  }

  nonisolated func toolPickerSelectedToolItemDidChange(_ toolPicker: PKToolPicker) {
    MainActor.assumeIsolated { remember() }
  }

  private func remember() {
    if picker.selectedToolItem is PKToolPickerInkingItem {
      lastInking = picker.selectedToolItemIdentifier
    }
  }
}
