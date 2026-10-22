import PDFKit
import PaperKit
import PencilKit
import UIKit
import XCTest

@testable import tauri_plugin_solstice_native

/// Dark paper (`Paper`): a way of showing pages and drawings that leaves every
/// saved byte as drawn. Runs on the iPad simulator, like the other tests here.
@MainActor
final class DarkPaperTests: XCTestCase {
  override func tearDown() async throws {
    Ink.shared.setDarkPaper(false)
  }

  // -- Ink --------------------------------------------------------------------

  private func blackStroke() -> PKStroke {
    let points = (0..<20).map {
      PKStrokePoint(
        location: CGPoint(x: 10 + CGFloat($0) * 8, y: 40), timeOffset: Double($0) * 0.01,
        size: CGSize(width: 8, height: 8), opacity: 1, force: 1, azimuth: 0, altitude: .pi / 2)
    }
    return PKStroke(
      ink: PKInk(.pen, color: .black), path: PKStrokePath(controlPoints: points, creationDate: Date()))
  }

  /// The mechanism dark paper rests on: PencilKit draws black ink light on a
  /// dark canvas and leaves the ink black.
  func testBlackInkIsShownLightAndStaysBlack() {
    let stroke = blackStroke()
    let drawing = PKDrawing(strokes: [stroke])
    let dark = UITraitCollection(userInterfaceStyle: .dark)
    var shown = UIImage()
    dark.performAsCurrent { shown = drawing.image(from: CGRect(x: 0, y: 0, width: 180, height: 80), scale: 1) }
    let (r, g, b, a) = pixel(of: shown, x: 90, y: 40)
    XCTAssertGreaterThan(a, 0.5)
    XCTAssertGreaterThan(min(r, g, b), 0.7, "black ink reads light on dark paper")

    var black: CGFloat = 1
    stroke.ink.color.getWhite(&black, alpha: nil)
    XCTAssertEqual(black, 0, accuracy: 0.01, "the ink itself is still black")
  }

  /// A file written with dark paper on is the file written with it off.
  func testDrawingFilesKeepTheirTrueColours() async throws {
    var markup = PaperMarkup(bounds: CGRect(x: 0, y: 0, width: 400, height: 300))
    markup.append(contentsOf: PKDrawing(strokes: [blackStroke()]))

    let light = try await DrawingFile.Writer().write(markup, text: "")
    Ink.shared.setDarkPaper(true)
    let dark = try await DrawingFile.Writer().write(markup, text: "")

    XCTAssertEqual(light, dark)
    XCTAssertTrue(dark.contains("stroke=\"#000000\""))
    XCTAssertTrue(dark.contains("fill=\"#fff\""), "the copy is on white paper")
  }

  // -- Pages ------------------------------------------------------------------

  private let page = CGRect(x: 0, y: 0, width: 200, height: 200)

  /// A white page: a black square, a red one and a blue picture, in page space.
  private func pdf(pictures: [CGRect] = [CGRect(x: 120, y: 120, width: 60, height: 60)]) -> Data {
    let data = NSMutableData()
    var box = page
    let context = CGContext(consumer: CGDataConsumer(data: data as CFMutableData)!, mediaBox: &box, nil)!
    context.beginPDFPage(nil)
    context.setFillColor(UIColor.white.cgColor)
    context.fill(page)
    context.setFillColor(UIColor.black.cgColor)
    context.fill(CGRect(x: 20, y: 20, width: 40, height: 40))
    context.setFillColor(UIColor(red: 1, green: 0, blue: 0, alpha: 1).cgColor)
    context.fill(CGRect(x: 20, y: 120, width: 40, height: 40))
    let blue = UIGraphicsImageRenderer(size: CGSize(width: 10, height: 10)).image {
      UIColor(red: 0, green: 0, blue: 1, alpha: 1).setFill()
      $0.fill(CGRect(x: 0, y: 0, width: 10, height: 10))
    }.cgImage!
    for rect in pictures { context.draw(blue, in: rect) }
    context.endPDFPage()
    context.closePDF()
    return data as Data
  }

  /// The page as PDFKit draws it, into a bitmap in page space.
  private func render(_ data: Data, dark: Bool) throws -> (CGContext, PaperPage) {
    PaperPage.dark = dark
    let document = try XCTUnwrap(PaperPages.shared.document(data: data))
    let page = try XCTUnwrap(document.page(at: 0) as? PaperPage, "pages are PaperPages")
    let context = CGContext(
      data: nil, width: 200, height: 200, bitsPerComponent: 8, bytesPerRow: 0,
      space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    page.draw(with: .cropBox, to: context)
    return (context, page)
  }

  /// A pixel at page-space (x, y), 0...1.
  private func colour(_ context: CGContext, x: Int, y: Int) -> (CGFloat, CGFloat, CGFloat) {
    let bytes = context.data!.assumingMemoryBound(to: UInt8.self)
    // Rows are stored top first.
    let i = (200 - 1 - y) * context.bytesPerRow + x * 4
    return (CGFloat(bytes[i]) / 255, CGFloat(bytes[i + 1]) / 255, CGFloat(bytes[i + 2]) / 255)
  }

  func testALightPageIsUntouched() throws {
    let (context, _) = try render(pdf(), dark: false)
    let paper = colour(context, x: 100, y: 100)
    XCTAssertGreaterThan(min(paper.0, paper.1, paper.2), 0.99)
    let ink = colour(context, x: 40, y: 40)
    XCTAssertLessThan(max(ink.0, ink.1, ink.2), 0.01)
  }

  func testADarkPageGoesDarkAndItsTextLight() throws {
    let (context, _) = try render(pdf(), dark: true)
    let paper = colour(context, x: 100, y: 100)
    XCTAssertEqual(paper.0, 0.11, accuracy: 0.03, "the paper is the ground")
    XCTAssertEqual(paper.2, 0.118, accuracy: 0.03)
    let text = colour(context, x: 40, y: 40)
    XCTAssertGreaterThan(min(text.0, text.1, text.2), 0.8, "black reads light")
  }

  func testADarkPageKeepsHues() throws {
    let (context, _) = try render(pdf(), dark: true)
    let red = colour(context, x: 40, y: 140)
    XCTAssertGreaterThan(red.0, red.1 + 0.2, "red stays red")
    XCTAssertGreaterThan(red.0, red.2 + 0.2)
  }

  func testPicturesKeepTheirColours() throws {
    let (context, _) = try render(pdf(), dark: true)
    let blue = colour(context, x: 150, y: 150)
    XCTAssertGreaterThan(blue.2, 0.95)
    XCTAssertLessThan(blue.0, 0.05)
    XCTAssertLessThan(blue.1, 0.05)
  }

  func testAWholePageScanIsInvertedWithThePage() throws {
    let (context, _) = try render(pdf(pictures: [page]), dark: true)
    // The picture is the page: inverted (bright blue turns dark), not kept.
    let blue = colour(context, x: 150, y: 150)
    XCTAssertLessThan(blue.2, 0.95)
  }

  func testPhotosAreFoundInPageSpace() throws {
    let (_, paperPage) = try render(pdf(), dark: false)
    let found = PdfImages.photos(on: try XCTUnwrap(paperPage.pageRef))
    XCTAssertEqual(found.count, 1)
    XCTAssertEqual(found.first?.origin.x ?? 0, 120, accuracy: 0.5)
    XCTAssertEqual(found.first?.origin.y ?? 0, 120, accuracy: 0.5)
    XCTAssertEqual(found.first?.width ?? 0, 60, accuracy: 0.5)
  }

  // -- Helpers ---------------------------------------------------------------

  private func pixel(of image: UIImage, x: Int, y: Int) -> (CGFloat, CGFloat, CGFloat, CGFloat) {
    let cg = image.cgImage!
    var bytes = [UInt8](repeating: 0, count: 4)
    let context = CGContext(
      data: &bytes, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
      space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    context.draw(cg, in: CGRect(x: -x, y: -(cg.height - 1 - y), width: cg.width, height: cg.height))
    let a = CGFloat(bytes[3]) / 255
    guard a > 0 else { return (0, 0, 0, 0) }
    return (CGFloat(bytes[0]) / 255 / a, CGFloat(bytes[1]) / 255 / a, CGFloat(bytes[2]) / 255 / a, a)
  }
}
