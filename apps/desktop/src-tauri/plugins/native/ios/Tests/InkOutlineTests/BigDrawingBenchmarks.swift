import PaperKit
import PencilKit
import UIKit
import XCTest

@testable import tauri_plugin_solstice_native

/// What PaperKit's calls cost on a huge drawing: the numbers the drawing
/// code is built around. Printed, not asserted (the simulator isn't an iPad);
/// `BENCH_STROKES` sets the size (default 100k). Skipped unless `BENCH=1`.
@MainActor
final class BigDrawingBenchmarks: XCTestCase {
  private var count: Int { Int(ProcessInfo.processInfo.environment["BENCH_STROKES"] ?? "") ?? 100_000 }

  override func setUp() async throws {
    try XCTSkipUnless(ProcessInfo.processInfo.environment["BENCH"] == "1", "BENCH=1 runs these")
  }

  /// Handwriting-like strokes, a short word each, in rows.
  static func strokes(_ count: Int, origin: CGPoint = CGPoint(x: 4000, y: 4000)) -> [PKStroke] {
    (0..<count).map { i in
      let x = origin.x + CGFloat(i % 200) * 24
      let y = origin.y + CGFloat(i / 200) * 30
      let points = (0..<40).map { j -> PKStrokePoint in
        let t = CGFloat(j)
        return PKStrokePoint(
          location: CGPoint(x: x + t * 0.5, y: y + 6 * sin(t / 3)), timeOffset: Double(j) * 0.01,
          size: CGSize(width: 3, height: 3), opacity: 1, force: 1, azimuth: 0, altitude: .pi / 2)
      }
      return PKStroke(ink: PKInk(.pen, color: .black), path: PKStrokePath(controlPoints: points, creationDate: Date()))
    }
  }

  static func markup(_ strokes: [PKStroke], side: CGFloat = 16384) -> PaperMarkup {
    var markup = PaperMarkup(bounds: CGRect(x: 0, y: 0, width: side, height: side))
    markup.append(contentsOf: PKDrawing(strokes: strokes))
    return markup
  }

  private func time(_ label: String, _ work: () throws -> Void) rethrows {
    let start = ContinuousClock.now
    try work()
    print("BENCH \(count) \(label): \((ContinuousClock.now - start).formatted(.units(allowed: [.milliseconds])))")
  }

  private func time(_ label: String, _ work: () async throws -> Void) async rethrows {
    let start = ContinuousClock.now
    try await work()
    print("BENCH \(count) \(label): \((ContinuousClock.now - start).formatted(.units(allowed: [.milliseconds])))")
  }

  private func controller(_ markup: PaperMarkup) -> (PaperMarkupViewController, UIWindow) {
    let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 1180, height: 820))
    let controller = PaperMarkupViewController(markup: markup, supportedFeatureSet: .latest)
    window.rootViewController = controller
    window.makeKeyAndVisible()
    controller.view.layoutIfNeeded()
    return (controller, window)
  }

  func testWhatPaperKitCosts() async throws {
    var markup = Self.markup(Self.strokes(count))
    var data = Data()
    try await time("dataRepresentation") { data = try await markup.dataRepresentation() }
    print("BENCH \(count) markup bytes: \(data.count)")
    try time("init(dataRepresentation:)") { markup = try PaperMarkup(dataRepresentation: data) }
    if let packed = try? (data as NSData).compressed(using: .zlib) as Data {
      print("BENCH \(count) zlib bytes: \(packed.count) (\(Int(Double(packed.count) / Double(data.count) * 100))%)")
      try time("zlib compress") { _ = try (data as NSData).compressed(using: .zlib) }
      try time("zlib decompress") { _ = try (packed as NSData).decompressed(using: .zlib) }
    }
    time("base64") { _ = data.base64EncodedString() }
    var set = markup.subelements
    time("subelements getter") { set = markup.subelements }
    time("set.count") { _ = set.count }
    var ids = set.ids
    time("set.ids") { ids = set.ids }
    time("ids.count") { _ = ids.count }
    var lastID = ids.first
    time("ids.last") { lastID = ids.last }
    time("ids[endIndex - 1]") { _ = ids[ids.index(before: ids.endIndex)] }
    time("set[count - 1]") { _ = set[set.count - 1] }
    if case .stroke(let id) = lastID { time("set[uuid]") { _ = set[id] } }
    if let lastID { time("set[elementID]") { _ = set[lastID] } }
    time("set.last via index") { _ = set[set.index(before: set.endIndex)] }
    time("stored set strokes") { _ = set.strokes }
    time("subelements.strokes") { _ = markup.subelements.strokes }
    time("subelements.ids") { _ = Array(markup.subelements.ids) }
    time("subelements.count + ids.last") { _ = (markup.subelements.count, markup.subelements.ids.last) }
    time("contentsRenderFrame") { _ = markup.contentsRenderFrame }
    let strokes = markup.subelements.strokes
    time("renderBounds of all") { _ = strokes.map(\.renderBounds) }
    time("stroke ids set") { _ = Set(strokes.map(\.id)) }
    time("InkOutline.key of all") { _ = strokes.map(InkOutline.key) }
    time("equatable") { _ = markup == markup }

    var (controller, window) = (PaperMarkupViewController?.none, UIWindow?.none)
    time("controller init + layout") { (controller, window) = self.controller(markup) }
    let live = try XCTUnwrap(controller)
    time("controller.markup get") { _ = live.markup }
    time("controller.markup get ×10") { for _ in 0..<10 { _ = live.markup } }
    var smaller = markup
    let last = try XCTUnwrap(strokes.last)
    time("removeStroke") { _ = smaller.subelements.removeStroke(for: last.id) }
    time("controller.markup set") {
      live.markup = smaller
      live.view.layoutIfNeeded()
    }
    _ = window
  }

  func testWhetherCanvasBoundsCost() {
    let strokes = Self.strokes(min(count, 20_000))
    for side: CGFloat in [16384, 262_144] {
      let markup = Self.markup(strokes, side: side)
      time("controller on \(Int(side)) side") {
        let (controller, window) = controller(markup)
        controller.setContentVisibleFrame(CGRect(x: 4000, y: 4000, width: 1180, height: 820), animated: false)
        controller.view.layoutIfNeeded()
        _ = window
      }
    }
  }

  /// Deleting through PaperKit's own selection, against setting a new markup.
  func testDeletingBySelection() throws {
    let markup = Self.markup(Self.strokes(count))
    let (controller, window) = controller(markup)
    _ = window
    controller.isEditable = true
    let ids = Array(markup.subelements.ids.suffix(20))
    controller.selection = Set(ids)
    controller.view.layoutIfNeeded()
    print("BENCH selected: \(controller.selection.count) first responder: \(controller.becomeFirstResponder())")
    let delete = #selector(UIResponderStandardEditActions.delete(_:))
    let cut = #selector(UIResponderStandardEditActions.cut(_:))
    var responders: [UIResponder] = [controller]
    func walk(_ v: UIView) { responders.append(v); v.subviews.forEach(walk) }
    walk(controller.view)
    for r in responders where r.canPerformAction(delete, withSender: nil) || r.canPerformAction(cut, withSender: nil) {
      print("BENCH responder can delete/cut: \(type(of: r)) delete=\(r.canPerformAction(delete, withSender: nil))")
    }
    if let target = responders.first(where: { $0.canPerformAction(delete, withSender: nil) }) {
      time("delete selected") {
        _ = target.perform(delete, with: nil)
        controller.view.layoutIfNeeded()
      }
      print("BENCH after delete: \(controller.markup?.subelements.count ?? -1), undo: \(controller.undoManager?.canUndo ?? false)")
      time("undo delete") { controller.undoManager?.undo() }
      print("BENCH after undo: \(controller.markup?.subelements.count ?? -1)")
    }
  }

  func testMoreCosts() async throws {
    var markup = Self.markup(Self.strokes(count))
    time("transformContent") { markup.transformContent(CGAffineTransform(translationX: 100, y: 100)) }
    var wide = markup
    wide.bounds = CGRect(x: -100_000, y: -100_000, width: 216_384, height: 216_384)
    print("BENCH negative-origin bounds kept: \(wide.bounds), content \(wide.contentsRenderFrame.integral)")
    let data = try await wide.dataRepresentation()
    let back = try PaperMarkup(dataRepresentation: data)
    print("BENCH negative-origin bounds round trip: \(back.bounds)")
    await time("indexableContent") { _ = await markup.indexableContent }
    var filtered = PaperMarkup(bounds: markup.bounds)
    let drop = Set(markup.subelements.strokes.suffix(20).map(\.id))
    time("rebuild without 20 strokes") {
      filtered.subelements.append(contentsOf: markup.subelements.filter {
        if case .stroke(let id) = $0.elementID { return !drop.contains(id) }
        return true
      })
    }
    print("BENCH rebuilt count \(filtered.subelements.count)")
    let (controller, window) = controller(markup)
    _ = window
    var one = markup
    one.append(contentsOf: PKDrawing(strokes: Self.strokes(1, origin: CGPoint(x: 100, y: 100))))
    time("controller.markup set (+1 stroke)") {
      controller.markup = one
      controller.view.layoutIfNeeded()
    }
    time("undo of a set") { controller.undoManager?.undo() }
  }

  /// A real drawing (`BENCH_DRAWING`, a version 1 file) written again: how
  /// big it is now, how long it takes to open and to save.
  func testARealDrawing() async throws {
    guard let path = ProcessInfo.processInfo.environment["BENCH_DRAWING"] else { throw XCTSkip("BENCH_DRAWING") }
    let url = URL(fileURLWithPath: path)
    let before = try Data(contentsOf: url)
    var contents = DrawingFile.Contents()
    try time("read version 1") { contents = try DrawingFile.read(contentsOf: url) }
    let markup = try XCTUnwrap(contents.markup)
    print("BENCH strokes: \(markup.subelements.strokes.count)")
    let writer = DrawingFile.Writer()
    var svg = ""
    try await time("first save (measures every stroke)") { svg = try await writer.write(markup, text: contents.text ?? "") }
    try await time("next save") { _ = try await writer.write(markup, text: contents.text ?? "") }
    print("BENCH size: \(before.count) → \(svg.utf8.count) bytes (\(Int(Double(svg.utf8.count) / Double(before.count) * 100))%)")
    let meta = svg.range(of: "</metadata>").map { svg.distance(from: svg.startIndex, to: $0.upperBound) } ?? 0
    print("BENCH markup part: \(meta) bytes, ink part: \(svg.utf8.count - meta) bytes")
    let raw = try await markup.dataRepresentation()
    print("BENCH markup raw \(raw.count), deflated \(((try? (raw as NSData).compressed(using: .lzfse)) as Data?)?.count ?? 0) lzfse, \(((try? (raw as NSData).compressed(using: .lzma)) as Data?)?.count ?? 0) lzma")
    let again = try DrawingFile.read(Data(svg.utf8))
    let reopened = DrawingFile.Writer()
    await reopened.seed(again.strokes)
    try await time("first save after reopening") { _ = try await reopened.write(try XCTUnwrap(again.markup), text: "") }
    let built = await reopened.built
    print("BENCH built after reopening: \(built)")
  }

  /// Opening and saving a big drawing as the app does, in the new format.
  func testABigDrawingOpensAndSaves() async throws {
    let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: folder) }
    let url = folder.appendingPathComponent("big.drawing.svg")
    let markup = Self.markup(Self.strokes(count))
    var svg = ""
    try await time("first save") { svg = try await DrawingFile.Writer().write(markup, text: "") }
    try svg.write(to: url, atomically: true, encoding: .utf8)
    print("BENCH \(count) file bytes: \(svg.utf8.count) (\(svg.utf8.count / count) a stroke)")
    var contents = DrawingFile.Contents()
    try time("read") { contents = try DrawingFile.read(contentsOf: url) }
    let writer = DrawingFile.Writer()
    await writer.seed(contents.strokes)
    try await time("save after opening") { _ = try await writer.write(try XCTUnwrap(contents.markup), text: "") }
    let built = await writer.built
    XCTAssertEqual(built, 0)
  }
}
