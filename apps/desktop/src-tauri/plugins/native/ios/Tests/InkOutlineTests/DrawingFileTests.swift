import ImageIO
import PaperKit
import PencilKit
import UIKit
import XCTest

@testable import tauri_plugin_solstice_native

/// What saving a drawing costs (`DrawingFile.Writer`): each save of a
/// growing drawing did all of it again, the picture layer over everything.
final class DrawingFileTests: XCTestCase {
  private func stroke(at origin: CGPoint) -> PKStroke {
    let points = (0...20).map {
      PKStrokePoint(
        location: CGPoint(x: origin.x + CGFloat($0) * 4, y: origin.y + CGFloat($0 % 3)), timeOffset: Double($0) * 0.01,
        size: CGSize(width: 4, height: 4), opacity: 1, force: 1, azimuth: 0, altitude: .pi / 2)
    }
    return PKStroke(ink: PKInk(.pen, color: .black), path: PKStrokePath(controlPoints: points, creationDate: Date()))
  }

  private func markup(strokes: [PKStroke]) -> PaperMarkup {
    var markup = PaperMarkup(bounds: CGRect(x: 0, y: 0, width: 16384, height: 16384))
    markup.append(contentsOf: PKDrawing(strokes: strokes))
    return markup
  }

  /// The drawing's ink, without the metadata (whose bytes PaperKit may vary).
  private func ink(_ svg: String) -> Substring {
    svg[svg.range(of: "</metadata>")!.upperBound...]
  }

  /// The picture layer's image, decoded.
  private func picture(in svg: String) throws -> CGImage? {
    guard let start = svg.range(of: "data:image/png;base64,") else { return nil }
    let end = try XCTUnwrap(svg.range(of: "\"", range: start.upperBound..<svg.endIndex))
    let data = try XCTUnwrap(Data(base64Encoded: String(svg[start.upperBound..<end.lowerBound])))
    let source = try XCTUnwrap(CGImageSourceCreateWithData(data as CFData, nil))
    return CGImageSourceCreateImageAtIndex(source, 0, nil)
  }

  func testASaveBuildsOnlyTheStrokesItHasntSeen() async throws {
    let writer = DrawingFile.Writer()
    var strokes = (0..<3).map { stroke(at: CGPoint(x: 1000, y: 1000 + CGFloat($0) * 30)) }
    _ = try await writer.write(markup(strokes: strokes), text: "")
    let firstBuilt = await writer.built
    XCTAssertEqual(firstBuilt, 3)

    strokes.append(stroke(at: CGPoint(x: 1000, y: 1200)))
    let again = try await writer.write(markup(strokes: strokes), text: "")
    let built = await writer.built
    XCTAssertEqual(built, 4)
    // The same file a fresh writer makes.
    let fresh = try await DrawingFile.Writer().write(markup(strokes: strokes), text: "")
    XCTAssertEqual(ink(again), ink(fresh))
  }

  /// A text box far from the ink made the picture layer the size of both,
  /// at three pixels a point: gigabytes, every save.
  func testThePictureIsOnlyAsBigAsWhatItShows() async throws {
    var markup = markup(strokes: [stroke(at: CGPoint(x: 1000, y: 1000))])
    markup.insertNewTextbox(
      attributedText: NSAttributedString(string: "far away"), frame: CGRect(x: 5000, y: 5000, width: 200, height: 60))
    let svg = try await DrawingFile.Writer().write(markup, text: "")
    let image = try XCTUnwrap(try picture(in: svg))
    XCTAssertLessThan(image.width, 2000)
    XCTAssertLessThan(image.height, 2000)
    XCTAssertLessThanOrEqual(image.width * image.height, DrawingFile.pictureBudget)
  }

  /// Taking the strokes out one at a time to draw the rest took seconds in
  /// a big drawing, on every save; an ink-only drawing has no rest to draw.
  func testWhatIsntInkIsTakenOutWhole() throws {
    var markup = markup(strokes: (0..<50).map { stroke(at: CGPoint(x: 1000, y: 1000 + CGFloat($0) * 10)) })
    XCTAssertNil(markup.withoutInk)
    markup.insertNewTextbox(
      attributedText: NSAttributedString(string: "note"), frame: CGRect(x: 2000, y: 2000, width: 200, height: 60))
    let rest = try XCTUnwrap(markup.withoutInk)
    XCTAssertEqual(rest.subelements.count, 1)
    XCTAssertEqual(markup.subelements.count, 51)
  }

  /// Growing the canvas moves everything on it: each stroke's look, measured
  /// with PencilKit, was measured again.
  func testAStrokesLookOutlastsAMove() {
    let original = stroke(at: CGPoint(x: 10, y: 10))
    var moved = original
    moved.transform = CGAffineTransform(translationX: 4096, y: 4096)
    XCTAssertEqual(InkOutline.key(of: original), InkOutline.key(of: moved))
  }

  // -- Opening again ------------------------------------------------------

  /// Each launch's first save measured every stroke again with PencilKit (a
  /// few milliseconds each: minutes in a big drawing). What the file holds
  /// of each stroke is used instead.
  func testAReopenedDrawingsFirstSaveBuildsNothing() async throws {
    let strokes = (0..<20).map { stroke(at: CGPoint(x: 1000, y: 1000 + CGFloat($0) * 30)) }
    let svg = try await DrawingFile.Writer().write(markup(strokes: strokes), text: "hello")
    let contents = try DrawingFile.read(Data(svg.utf8))
    XCTAssertEqual(contents.strokes.count, 20)
    XCTAssertEqual(contents.text, "hello")

    let writer = DrawingFile.Writer()
    await writer.seed(contents.strokes)
    let again = try await writer.write(try XCTUnwrap(contents.markup), text: "hello")
    let built = await writer.built
    XCTAssertEqual(built, 0)
    XCTAssertEqual(ink(again), ink(svg))
  }

  /// The canvas growing (or the lasso) moved strokes, and every moved
  /// stroke's SVG was made again.
  func testMovingEverythingBuildsNothing() async throws {
    let writer = DrawingFile.Writer()
    var markup = markup(strokes: (0..<10).map { stroke(at: CGPoint(x: 1000, y: 1000 + CGFloat($0) * 30)) })
    _ = try await writer.write(markup, text: "")
    markup.transformContent(CGAffineTransform(translationX: 4096, y: -512))
    let moved = try await writer.write(markup, text: "")
    let built = await writer.built
    XCTAssertEqual(built, 10)
    XCTAssertTrue(moved.contains("translate(4096 -512)") || moved.contains("translate(4096"))
  }

  /// The picture layer was drawn again on every save, even when only ink
  /// had changed.
  func testThePictureIsDrawnOnlyWhenWhatItShowsChanges() async throws {
    let writer = DrawingFile.Writer()
    var markup = markup(strokes: [stroke(at: CGPoint(x: 1000, y: 1000))])
    markup.insertNewTextbox(
      attributedText: NSAttributedString(string: "note"), frame: CGRect(x: 1200, y: 1000, width: 200, height: 60))
    _ = try await writer.write(markup, text: "")
    markup.append(contentsOf: PKDrawing(strokes: [stroke(at: CGPoint(x: 1000, y: 1100))]))
    _ = try await writer.write(markup, text: "")
    let pictures = await writer.pictures
    XCTAssertEqual(pictures, 1)
  }

  /// PaperKit's markup is most of a drawing's file: it's deflated.
  func testTheMarkupIsDeflated() async throws {
    let strokes = (0..<200).map { stroke(at: CGPoint(x: 1000 + CGFloat($0 % 20) * 90, y: 1000 + CGFloat($0 / 20) * 30)) }
    let markup = markup(strokes: strokes)
    let raw = try await markup.dataRepresentation()
    let svg = try await DrawingFile.Writer().write(markup, text: "")
    XCTAssertTrue(svg.contains("encoding=\"deflate\""))
    XCTAssertLessThan(svg.utf8.count, raw.base64EncodedString().utf8.count)
    let read = try XCTUnwrap(try DrawingFile.read(Data(svg.utf8)).markup)
    XCTAssertEqual(read.subelements.strokes.count, 200)
  }

  /// Files saved before: the markup undeflated, its `<desc>` after it.
  func testAnOldFileStillOpens() async throws {
    let markup = markup(strokes: [stroke(at: CGPoint(x: 1000, y: 1000))])
    let data = try await markup.dataRepresentation()
    let old = """
      <svg xmlns="http://www.w3.org/2000/svg" xmlns:solstice="\(DrawingFile.namespace)" viewBox="976 976 128 72" width="128" height="72">
        <metadata><solstice:paper version="1">\(data.base64EncodedString())</solstice:paper></metadata>
        <desc>old &amp; good</desc>
        <rect x="976" y="976" width="128" height="72" fill="#fff"/>
      </svg>
      """
    let contents = try DrawingFile.read(Data(old.utf8))
    XCTAssertEqual(contents.markup?.subelements.strokes.count, 1)
    XCTAssertEqual(contents.text, "old & good")
    XCTAssertEqual(contents.drawn, CGRect(x: 976, y: 976, width: 128, height: 72))
  }

  /// A drawing whose markup couldn't be read opened as a blank canvas, and
  /// its first save wrote the blank over it.
  func testAnUnreadableOrNewerFileIsntTakenForANewOne() {
    let corrupt = #"<svg><metadata><solstice:paper version="2" encoding="deflate">bm90IGRlZmxhdGVk</solstice:paper></metadata></svg>"#
    XCTAssertThrowsError(try DrawingFile.read(Data(corrupt.utf8)))
    let newer = #"<svg><metadata><solstice:paper version="9">AAAA</solstice:paper></metadata></svg>"#
    XCTAssertThrowsError(try DrawingFile.read(Data(newer.utf8))) { error in
      guard case DrawingFile.ReadError.newer(9) = error else { return XCTFail("\(error)") }
    }
    XCTAssertNil(try DrawingFile.read(Data()).markup, "an empty file is a new drawing")
  }
}
