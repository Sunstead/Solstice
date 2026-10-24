import PaperKit
import PencilKit
import ScratchOut
import SurfaceCore
import UIKit

/// Scratching out ink with the Pencil, as iPadOS scratches out text: a quick
/// back-and-forth over strokes erases them and itself, as one undo. One per
/// canvas. The geometry is the ScratchOut package's; PencilKit and PaperKit
/// have nothing for ink.
///
/// Only the Pencil scratches out (a finger drawing is often shading), only
/// with ink that writes (not a highlighter, marker or crayon), and only over
/// strokes: over empty paper a scribble stays ink.
///
/// The Pencil's own line (`track`) says whether a stroke is a scribble, so an
/// ordinary stroke costs nothing: in a big drawing, reading the markup's
/// strokes takes about a second, and that was done after every stroke.
@MainActor
final class Scratcher {
  nonisolated private static let inks: Set<PKInk.InkType> = [.pen, .pencil, .monoline, .fountainPen, .reed]
  private static let writing: Set<ToolSpec.Kind> = [.pen, .pencil, .monoline, .fountainPen, .reed]

  /// The Pencil's line so far, in markup space, and the canvas it's on.
  private var line: [CGPoint] = []
  private weak var canvas: PaperMarkupViewController?
  /// The canvas's markup changed since the Pencil landed: its stroke is in.
  private var strokeIn = false
  /// A scribble whose stroke hasn't reached the markup yet.
  private var waiting: (line: [CGPoint], since: Date)?
  private var erasing = false

  /// The Pencil landed, moved or lifted on `controller`'s canvas.
  func track(_ gesture: UIGestureRecognizer, on controller: PaperMarkupViewController?) {
    switch gesture.state {
    case .began:
      canvas = controller
      line = []
      strokeIn = false
      waiting = nil
      fallthrough
    case .changed:
      if let canvas { line.append(Self.markupPoint(gesture.location(in: canvas.view), in: canvas)) }
    case .ended:
      guard let canvas, Ink.shared.scratchOut, Self.writing.contains(Ink.shared.spec.kind),
        ScratchOut.isScratch(line)
      else { return }
      if strokeIn { erase(line, on: canvas) } else { waiting = (line, Date()) }
    default:
      line = []
    }
  }

  /// After a change to `controller`'s markup.
  func changed(_ controller: PaperMarkupViewController) {
    guard controller === canvas else { return }
    strokeIn = true
    guard let waiting else { return }
    self.waiting = nil
    if -waiting.since.timeIntervalSinceNow < 1 { erase(waiting.line, on: controller) }
  }

  private func erase(_ line: [CGPoint], on controller: PaperMarkupViewController) {
    Task { [weak self, weak controller] in
      guard let controller else { return }
      await self?.scratch(line, on: controller)
    }
  }

  /// Finds the scribble along `line` and what it covers off the main
  /// thread, then erases them. Returns whether it did.
  @discardableResult
  func scratch(_ line: [CGPoint], on controller: PaperMarkupViewController) async -> Bool {
    guard !erasing, let markup = controller.markup else { return false }
    erasing = true
    defer { erasing = false }
    let found = await Task.detached(priority: .userInitiated) { Self.find(line, in: markup) }.value
    guard let found else { return false }
    apply(found, to: controller)
    return true
  }

  /// The newest stroke where the Pencil went, if it's a scribble, and the
  /// strokes it covers.
  nonisolated static func find(_ line: [CGPoint], in markup: PaperMarkup) -> (scribble: UUID, erased: [UUID])? {
    let strokes = markup.subelements.strokes
    let area = bounds(of: line).insetBy(dx: -8, dy: -8)
    guard
      let index = strokes.indices.reversed().prefix(8).first(where: {
        inks.contains(strokes[$0].ink.inkType) && strokes[$0].renderBounds.intersects(area)
      })
    else { return nil }
    let scratch = strokes[index]
    let path = points(of: scratch)
    guard ScratchOut.isScratch(path) else { return nil }
    let others = strokes.indices.filter { $0 != index }
    let width = scratch.path.map { $0.size.width }.reduce(0, +) / CGFloat(max(1, scratch.path.count))
    let reach = max(2, width)
    // Only strokes near it are looked at point by point.
    let near = ScratchOut.nearby(path, reach: reach, bounds: others.map { strokes[$0].renderBounds })
    let hit = ScratchOut.covered(by: path, reach: reach, strokes: near.map { points(of: strokes[others[$0]]) })
    guard !hit.isEmpty else { return nil }
    return (scratch.id, hit.map { strokes[others[near[$0]]].id })
  }

  /// Takes out the scribble, then what it covers, as PaperKit's own steps.
  private func apply(_ found: (scribble: UUID, erased: [UUID]), to controller: PaperMarkupViewController) {
    guard controller.markup?.subelements[found.scribble] != nil else { return }
    // The scribble goes by PaperKit's own undo of it, so no step that
    // undoes nothing is left behind; or, if that undid something else,
    // put back and taken out with the rest.
    var scribbled = [found.scribble]
    if let manager = controller.undoManager, manager.canUndo {
      manager.undo()
      if controller.markup?.subelements[found.scribble] == nil {
        scribbled = []
      } else {
        manager.redo()
      }
    }
    if !scribbled.isEmpty { delete(scribbled, in: controller) }
    // One step: undone, the strokes come back without the scribble.
    delete(found.erased, in: controller)
  }

  /// Deletes `ids` as PaperKit's own Delete does: in place, with its undo.
  /// (Setting a new markup redraws the whole canvas, which blinks.)
  private func delete(_ ids: [UUID], in controller: PaperMarkupViewController) {
    controller.selection = Set(ids.map { MarkupOrderedSet.ElementID($0) })
    let action = #selector(UIResponderStandardEditActions.delete(_:))
    if let responder = Self.responders(in: controller.view).first(where: { $0.canPerformAction(action, withSender: nil) }) {
      responder.perform(action, with: nil)
      return
    }
    // Nothing takes Delete: the markup without them, undone as one step.
    controller.selection = []
    guard let before = controller.markup else { return }
    let gone = Set(ids)
    var after = PaperMarkup(bounds: before.bounds)
    after.backgroundColor = before.backgroundColor
    after.subelements.append(contentsOf: before.subelements.filter {
      if case .stroke(let id) = $0.elementID { return !gone.contains(id) }
      return true
    })
    set(after, on: controller, undo: before)
  }

  private func set(_ markup: PaperMarkup, on controller: PaperMarkupViewController, undo: PaperMarkup) {
    controller.markup = markup
    guard let manager = controller.undoManager else { return }
    manager.registerUndo(withTarget: self) { [weak controller] scratcher in
      guard let controller else { return }
      scratcher.set(undo, on: controller, undo: markup)
    }
    manager.setActionName("Scratch Out")
  }

  /// A point in `controller`'s view, in its markup's space: the view shows
  /// `contentVisibleFrame`. (Its `contentView` is nil on an empty canvas.)
  static func markupPoint(_ point: CGPoint, in controller: PaperMarkupViewController) -> CGPoint {
    let visible = controller.contentVisibleFrame
    let size = controller.view.bounds.size
    guard size.width > 0, size.height > 0 else { return point }
    return CGPoint(
      x: visible.minX + point.x / size.width * visible.width, y: visible.minY + point.y / size.height * visible.height)
  }

  private static func responders(in view: UIView) -> [UIResponder] {
    [view] + view.subviews.flatMap(responders)
  }

  nonisolated private static func bounds(of points: [CGPoint]) -> CGRect {
    guard let first = points.first else { return .null }
    return points.reduce(CGRect(origin: first, size: .zero)) { $0.union(CGRect(origin: $1, size: .zero)) }
  }

  /// A stroke's line, every few points, in the markup's coordinates.
  nonisolated private static func points(of stroke: PKStroke) -> [CGPoint] {
    stroke.path.interpolatedPoints(by: .distance(3)).map { $0.location.applying(stroke.transform) }
  }
}
