import UIKit

/// The Taptic Engine's feedback, for gestures the web can't buzz for: iOS has
/// no `navigator.vibrate`. Generators are kept and `prepare`d, since a fresh
/// one lags its first tick by tens of milliseconds.
enum Haptics {
  private static let impact = UIImpactFeedbackGenerator(style: .medium)
  private static let light = UIImpactFeedbackGenerator(style: .light)
  private static let selection = UISelectionFeedbackGenerator()
  private static let notification = UINotificationFeedbackGenerator()

  /// Wakes the engine for the tick about to come (a press that may lift).
  static func prepare() {
    impact.prepare()
    light.prepare()
    selection.prepare()
  }

  /// `lift`: something picked up. `drop`: put down. `tick`: crossed a slot
  /// (a reordered tab). `dismiss`: a sheet let go of. `select`: a choice
  /// changed. `hold`: a hold opened a sheet. `commit`: a swipe passed its
  /// point. `light`: a pull that triggers. `success`, `warning`: done, or
  /// about to destroy.
  static func play(_ kind: String) {
    switch kind {
    case "lift":
      impact.impactOccurred(intensity: 0.9)
    case "drop":
      impact.impactOccurred(intensity: 0.6)
    case "tick":
      selection.selectionChanged()
    case "dismiss":
      impact.impactOccurred(intensity: 0.4)
    case "warning":
      notification.notificationOccurred(.warning)
    case "success":
      notification.notificationOccurred(.success)
    case "select":
      selection.selectionChanged()
    case "hold", "commit":
      impact.impactOccurred()
    case "light":
      light.impactOccurred()
    default:
      break
    }
  }
}
