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
    svg[svg.range(of: "</desc>")!.upperBound...]
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
}
