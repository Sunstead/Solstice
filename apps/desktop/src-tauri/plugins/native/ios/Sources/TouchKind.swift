import UIKit

/// Reports whether each touch landing is the Pencil's, before the view's
/// other gestures act on it, and never takes part itself: PDFs' markup mode,
/// and whose stroke a scratch-out is (`Scratcher`). (Hit testing comes
/// too early: its event doesn't hold the touch yet.)
final class TouchKind: UIGestureRecognizer, UIGestureRecognizerDelegate {
  private let landed: (_ pencil: Bool) -> Void
  /// The last touch to land was the Pencil's (or landed while it was down).
  private(set) var pencil = false

  init(_ landed: @escaping (_ pencil: Bool) -> Void) {
    self.landed = landed
    super.init(target: nil, action: nil)
    cancelsTouchesInView = false
    delaysTouchesBegan = false
    delaysTouchesEnded = false
    delegate = self
  }

  override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
    // A Pencil landing with a palm already down, or still down as a finger
    // lands: markup stays on.
    let all = event.allTouches ?? touches
    pencil = all.contains { $0.type == .pencil && $0.phase != .ended && $0.phase != .cancelled }
    landed(pencil)
  }

  override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) { finish(event) }
  override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) { finish(event) }

  /// Watches until every touch has lifted, so a second one landing is seen too.
  private func finish(_ event: UIEvent) {
    let down = event.allTouches?.contains { $0.phase != .ended && $0.phase != .cancelled } ?? false
    if !down { state = .failed }
  }

  func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
    true
  }
}
