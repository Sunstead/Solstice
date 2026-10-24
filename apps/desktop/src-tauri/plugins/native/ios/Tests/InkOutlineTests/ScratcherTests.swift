import PaperKit
import PencilKit
import UIKit
import XCTest

@testable import tauri_plugin_solstice_native

/// Scratching out on a live PaperKit canvas: what goes, what one undo brings
/// back, and that a big drawing doesn't make it slow.
@MainActor
final class ScratcherTests: XCTestCase {
  private var window: UIWindow!

  override func tearDown() async throws {
    window = nil
  }

  private func stroke(_ points: [CGPoint], width: CGFloat = 3) -> PKStroke {
    let samples = points.enumerated().map { i, p in
      PKStrokePoint(
        location: p, timeOffset: Double(i) * 0.01, size: CGSize(width: width, height: width), opacity: 1, force: 1,
        azimuth: 0, altitude: .pi / 2)
    }
    return PKStroke(ink: PKInk(.pen, color: .black), path: PKStrokePath(controlPoints: samples, creationDate: Date()))
  }

  /// A short word at `origin`.
  private func word(at origin: CGPoint) -> PKStroke {
    stroke((0...30).map { CGPoint(x: origin.x + CGFloat($0) * 2, y: origin.y + 6 * sin(CGFloat($0) / 3)) })
  }

  /// Back and forth over `area`, as a hand scratches out.
  private func scribble(over area: CGRect) -> [CGPoint] {
    (0...160).map { i in
      let t = CGFloat(i) / 160
      let sweep = (t * 6).truncatingRemainder(dividingBy: 2)
      let x = sweep < 1 ? area.minX + sweep * area.width : area.maxX - (sweep - 1) * area.width
      return CGPoint(x: x, y: area.minY + t * area.height)
    }
  }

  private func canvas(_ strokes: [PKStroke], showing visible: CGRect) -> PaperMarkupViewController {
    var markup = PaperMarkup(bounds: CGRect(x: 0, y: 0, width: 16384, height: 16384))
    markup.append(contentsOf: PKDrawing(strokes: strokes))
    window = UIWindow(frame: CGRect(x: 0, y: 0, width: 1180, height: 820))
    let controller = PaperMarkupViewController(markup: markup, supportedFeatureSet: .latest)
    controller.isEditable = true
    controller.zoomRange = 0.1...8
    window.rootViewController = controller
    window.makeKeyAndVisible()
    controller.view.layoutIfNeeded()
    controller.setContentVisibleFrame(visible, animated: false)
    controller.view.layoutIfNeeded()
    _ = controller.becomeFirstResponder()
    return controller
  }

  /// Adds `stroke` as drawing it would: one step PaperKit can undo.
  private func draw(_ stroke: PKStroke, on controller: PaperMarkupViewController) throws -> UUID {
    var contents = PaperMarkup(bounds: controller.markup!.bounds)
    contents.append(contentsOf: PKDrawing(strokes: [stroke]))
    controller.markupEditViewController(MarkupEditViewController(supportedFeatureSet: .latest), insertNewContents: contents)
    controller.selection = []
    let added = try XCTUnwrap(controller.markup?.subelements.strokes.last)
    return added.id
  }

  private func strokeIDs(_ controller: PaperMarkupViewController) -> Set<UUID> {
    Set(controller.markup?.subelements.strokes.map(\.id) ?? [])
  }

  /// The Pencil's line, read in the canvas's view, is put in markup space:
  /// where PaperKit's own content view has it, zoomed in or out.
  func testThePencilsLineIsInMarkupSpace() throws {
    let visible = CGRect(x: 5000, y: 5000, width: 1180, height: 820)
    let controller = canvas([word(at: CGPoint(x: 5100, y: 5100))], showing: visible)
    for zoom: CGFloat in [1, 0.5, 2] {
      controller.setContentVisibleFrame(
        CGRect(x: visible.minX, y: visible.minY, width: visible.width / zoom, height: visible.height / zoom), animated: false)
      controller.view.layoutIfNeeded()
      // PaperKit's zoomed content: the markup, from its own origin.
      let scroll = try XCTUnwrap(controller.view.subviews(of: UIScrollView.self).first)
      let content = try XCTUnwrap(scroll.subviews.first { $0.bounds.size == controller.markup?.bounds.size })
      XCTAssertEqual(scroll.zoomScale, zoom, accuracy: 0.01)
      for point in [CGPoint(x: 0, y: 0), CGPoint(x: 300, y: 200), CGPoint(x: 1100, y: 800)] {
        let expected = content.convert(point, from: controller.view)
        let mapped = Scratcher.markupPoint(point, in: controller)
        XCTAssertEqual(mapped.x, expected.x, accuracy: 1, "zoom \(zoom)")
        XCTAssertEqual(mapped.y, expected.y, accuracy: 1, "zoom \(zoom)")
      }
    }
  }

  func testAScribbleErasesWhatItCoversAndOneUndoBringsItBack() async throws {
    let words = (0..<3).map { word(at: CGPoint(x: 5100, y: 5100 + CGFloat($0) * 14)) }
    let elsewhere = word(at: CGPoint(x: 5600, y: 5400))
    let controller = canvas(words + [elsewhere], showing: CGRect(x: 5000, y: 5000, width: 1180, height: 820))
    let before = strokeIDs(controller)
    let line = scribble(over: CGRect(x: 5095, y: 5090, width: 70, height: 45))
    let scribbleID = try draw(stroke(line), on: controller)
    let drawn = try XCTUnwrap(controller.markup?.subelements[scribbleID])
    XCTAssertEqual(drawn.renderBounds.midX, 5130, accuracy: 20, "drawn where it was put")

    let scratcher = Scratcher()
    let erased = await scratcher.scratch(line, on: controller)
    XCTAssertTrue(erased)
    let left = strokeIDs(controller)
    XCTAssertEqual(left, [before.first { controller.markup?.subelements[$0]?.renderBounds.minX ?? 0 > 5500 }!])

    controller.undoManager?.undo()
    XCTAssertEqual(strokeIDs(controller), before, "the words back, without the scribble")
    controller.undoManager?.redo()
    XCTAssertEqual(strokeIDs(controller), left)
  }

  func testAScribbleOverEmptyPaperStaysInk() async throws {
    let controller = canvas([word(at: CGPoint(x: 5600, y: 5400))], showing: CGRect(x: 5000, y: 5000, width: 1180, height: 820))
    let line = scribble(over: CGRect(x: 5095, y: 5090, width: 70, height: 45))
    _ = try draw(stroke(line), on: controller)
    let erased = await Scratcher().scratch(line, on: controller)
    XCTAssertFalse(erased)
    XCTAssertEqual(controller.markup?.subelements.strokes.count, 2)
  }

  /// Writing over a big drawing used to read every stroke after each one;
  /// scratching out reads them once, off the main thread.
  func testScratchingOutABigDrawingIsQuick() async throws {
    let filler = BigDrawingBenchmarks.strokes(20_000, origin: CGPoint(x: 200, y: 200))
    let words = (0..<3).map { word(at: CGPoint(x: 5100, y: 5100 + CGFloat($0) * 14)) }
    let controller = canvas(filler + words, showing: CGRect(x: 5000, y: 5000, width: 1180, height: 820))
    let line = scribble(over: CGRect(x: 5095, y: 5090, width: 70, height: 45))
    _ = try draw(stroke(line), on: controller)
    let start = ContinuousClock.now
    let erased = await Scratcher().scratch(line, on: controller)
    let took = ContinuousClock.now - start
    XCTAssertTrue(erased)
    XCTAssertEqual(controller.markup?.subelements.strokes.count, 20_000)
    print("BENCH scratch-out over 20k strokes: \(took)")
    XCTAssertLessThan(took, .seconds(2))
  }
}
