import PaperKit
import PencilKit
import ScratchOut
import UIKit

/// Scratching out ink with the Pencil, as iPadOS scratches out text: a quick
/// back-and-forth over strokes erases them and itself, as one undo. One per
/// canvas, told of each change to its markup (`check`). The geometry is the
/// ScratchOut package's; PencilKit and PaperKit have nothing for ink.
///
/// Only the Pencil scratches out (a finger drawing is often shading), only
/// with ink that writes (not a highlighter, marker or crayon), and only over
/// strokes: over empty paper a scribble stays ink.
@MainActor
final class Scratcher {
  private static let inks: Set<PKInk.InkType> = [.pen, .pencil, .monoline, .fountainPen, .reed]

  /// The strokes the canvas had at its last change.
  private var known: Set<UUID>

  init(_ markup: PaperMarkup?) {
    known = Self.ids(markup)
  }

  /// After a change to `controller`'s markup: erases what a stroke it just
  /// gained scratches out, if `pencil` drew it. Returns whether it will.
  @discardableResult
  func check(_ controller: PaperMarkupViewController, pencil: Bool) -> Bool {
    guard let markup = controller.markup else { return false }
    let strokes = markup.subelements.strokes
    let added = strokes.filter { !known.contains($0.id) }
    known = Self.ids(markup)
    guard
      Ink.shared.scratchOut, pencil, added.count == 1, let scratch = added.first,
      Self.inks.contains(scratch.ink.inkType)
    else { return false }

    let path = Self.points(of: scratch)
    guard ScratchOut.isScratch(path) else { return false }
    let others = strokes.filter { $0.id != scratch.id }
    let width = scratch.path.map { $0.size.width }.reduce(0, +) / CGFloat(max(1, scratch.path.count))
    let hit = ScratchOut.covered(by: path, reach: max(2, width), strokes: others.map(Self.points))
    guard !hit.isEmpty else { return false }

    // Once PaperKit is done taking the stroke: changed from inside its own
    // change, the canvas goes on drawing what it had.
    let erased = hit.map { others[$0].id }
    DispatchQueue.main.async { [weak self, weak controller] in
      guard let self, let controller, var before = controller.markup,
        before.subelements[scratch.id] != nil
      else { return }
      // The scribble goes by PaperKit's own undo of it, so no step that
      // undoes nothing is left behind; or, if that undid something else,
      // put back and taken out here.
      if let manager = controller.undoManager, manager.canUndo {
        manager.undo()
        if let undone = controller.markup, undone.subelements[scratch.id] == nil {
          before = undone
        } else {
          manager.redo()
        }
      }
      // Undone, the strokes come back without the scribble.
      before.subelements.removeStroke(for: scratch.id)
      var after = before
      for id in erased { after.subelements.removeStroke(for: id) }
      self.apply(after, to: controller, undo: before)
    }
    return true
  }

  /// Sets `markup`, registering `undo` (and its own redo) as one step.
  private func apply(_ markup: PaperMarkup, to controller: PaperMarkupViewController, undo: PaperMarkup) {
    controller.markup = markup
    known = Self.ids(markup)
    guard let manager = controller.undoManager else { return }
    manager.registerUndo(withTarget: self) { [weak controller] scratcher in
      guard let controller else { return }
      scratcher.apply(undo, to: controller, undo: markup)
    }
    manager.setActionName("Scratch Out")
  }

  private static func ids(_ markup: PaperMarkup?) -> Set<UUID> {
    Set(markup?.subelements.strokes.map(\.id) ?? [])
  }

  /// A stroke's line, every few points, in the markup's coordinates.
  private static func points(of stroke: PKStroke) -> [CGPoint] {
    stroke.path.interpolatedPoints(by: .distance(3)).map { $0.location.applying(stroke.transform) }
  }
}
