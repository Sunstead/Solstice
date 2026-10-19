import ImageIO
import PaperKit
import PencilKit
import UIKit
import XCTest

@testable import tauri_plugin_solstice_native

/// Marking up a bitmap (`ImageSurface`): saving draws the marks over the
/// image as opened, at its own size, in its own format.
@MainActor
final class ImageMarkupTests: XCTestCase {
  /// A solid `colour` image, `width` × `height` pixels.
  private func solid(_ colour: UIColor, width: Int, height: Int) -> CGImage {
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    return UIGraphicsImageRenderer(size: CGSize(width: width, height: height), format: format).image { context in
      colour.setFill()
      context.fill(CGRect(x: 0, y: 0, width: width, height: height))
    }.cgImage!
  }

  /// The pixel at (`x`, `y`), from the top left, as RGB 0...255.
  private func pixel(_ image: CGImage, _ x: Int, _ y: Int) -> [Int] {
    var bytes = [UInt8](repeating: 0, count: 4)
    let context = CGContext(
      data: &bytes, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
      space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    context.draw(image, in: CGRect(x: -x, y: y - image.height + 1, width: image.width, height: image.height))
    return bytes.prefix(3).map(Int.init)
  }

  /// The image locked under a black stroke across its middle, as the surface holds it.
  private func markup(over image: CGImage) -> PaperMarkup {
    let bounds = CGRect(x: 0, y: 0, width: image.width, height: image.height)
    var markup = PaperMarkup(bounds: bounds)
    markup.subelements.append(ImageMarkup(image: image, frame: bounds, allowedInteractions: []))
    let points = (0...20).map {
      PKStrokePoint(
        location: CGPoint(x: 10 + CGFloat($0) * 9, y: 50), timeOffset: Double($0) * 0.01,
        size: CGSize(width: 12, height: 12), opacity: 1, force: 1, azimuth: 0, altitude: .pi / 2)
    }
    let stroke = PKStroke(ink: PKInk(.monoline, color: .black), path: PKStrokePath(controlPoints: points, creationDate: Date()))
    markup.append(contentsOf: PKDrawing(strokes: [stroke]))
    return markup
  }

  func testTheMarksAreDrawnOverTheImageAtItsSize() async throws {
    let image = solid(.red, width: 200, height: 120)
    let flattened = await ImageSurface.flatten(markup(over: image), size: CGSize(width: 200, height: 120))
    let flat = try XCTUnwrap(flattened)
    XCTAssertEqual(flat.width, 200)
    XCTAssertEqual(flat.height, 120)
    // Under the stroke: black. Away from it: the image, untouched.
    XCTAssertLessThan(pixel(flat, 100, 50).max()!, 60)
    let away = pixel(flat, 100, 105)
    XCTAssertGreaterThan(away[0], 230)
    XCTAssertLessThan(away[1], 30)
  }

  func testItIsWrittenInTheFormatItWasIn() throws {
    let image = solid(.blue, width: 64, height: 48)
    for (path, type) in [("a.png", "public.png"), ("b.JPG", "public.jpeg"), ("c.heic", "public.heic")] {
      let data = try XCTUnwrap(ImageSurface.encode(image, like: path), path)
      let source = try XCTUnwrap(CGImageSourceCreateWithData(data as CFData, nil))
      XCTAssertEqual(CGImageSourceGetType(source) as String?, type, path)
      let decoded = try XCTUnwrap(CGImageSourceCreateImageAtIndex(source, 0, nil))
      XCTAssertEqual(decoded.width, 64, path)
      XCTAssertEqual(decoded.height, 48, path)
    }
  }
}
