import PencilKit
import UIKit
import XCTest

@testable import tauri_plugin_solstice_native

/// What every other reader sees of the iPad's ink (`InkOutline`, written into
/// a PDF and drawn back) against PencilKit's own drawing of the same strokes:
/// the same width, the same shape.
///
/// PencilKit needs iOS, so this runs on the iPad simulator, not CI:
///
///     xcodebuild test -scheme tauri-plugin-solstice-native \
///       -destination 'platform=iOS Simulator,name=iPad Pro 11-inch (M5)'
///
/// from `plugins/native/ios`.
final class InkOutlineTests: XCTestCase {
  /// Pixels per point both are drawn at.
  private let scale: CGFloat = 8

  func testAStraightLine() async throws {
    try await compare(line((0..<120).map { CGPoint(x: 20 + CGFloat($0) * 1.5, y: 40 + CGFloat($0) * 0.4) }))
  }

  func testACircle() async throws {
    try await compare(line((0...160).map { i in
      let a = CGFloat(i) / 160 * 2 * .pi
      return CGPoint(x: 80 + 30 * cos(a), y: 80 + 30 * sin(a))
    }))
  }

  /// Joined-up handwriting: loops a few points across.
  func testHandwriting() async throws {
    try await compare(line((0...300).map { i in
      let t = CGFloat(i) / 300
      return CGPoint(x: 20 + 160 * t + 6 * sin(t * 40), y: 60 + 9 * cos(t * 40) + 4 * sin(t * 7))
    }))
  }

  /// Pressing harder along the stroke.
  func testAPressureRamp() async throws {
    try await compare(line((0..<140).map { CGPoint(x: 20 + CGFloat($0) * 1.4, y: 50) }, force: { 0.2 + 2.8 * $0 }))
  }

  /// A thin pen. (Points of size 1.6 PencilKit doesn't draw at all.)
  func testAThinPen() async throws {
    try await compare(line((0...200).map { i in
      let t = CGFloat(i) / 200
      return CGPoint(x: 20 + 150 * t, y: 60 + 20 * sin(t * 12))
    }, size: 2.4))
  }

  // -- Strokes -----------------------------------------------------------

  private func line(
    _ points: [CGPoint], size: CGFloat = 3.4, force: (CGFloat) -> CGFloat = { _ in 1 }
  ) -> PKStroke {
    let controls = points.enumerated().map { i, p in
      PKStrokePoint(
        location: p, timeOffset: Double(i) / 120, size: CGSize(width: size, height: size), opacity: 1,
        force: force(CGFloat(i) / CGFloat(max(points.count - 1, 1))), azimuth: 0, altitude: .pi / 3)
    }
    return PKStroke(ink: PKInk(.pen, color: .black), path: PKStrokePath(controlPoints: controls, creationDate: Date()))
  }

  // -- Comparing ---------------------------------------------------------

  private func compare(_ stroke: PKStroke, file: StaticString = #filePath, line: UInt = #line) async throws {
    let rect = stroke.renderBounds.insetBy(dx: -4, dy: -4).integral
    let truth = try XCTUnwrap(pencilKit(stroke, rect))
    let look = await InkOutline.looks(of: [stroke])[0]
    let ours = try XCTUnwrap(outline(stroke, look, rect))
    XCTAssertEqual(truth.count, ours.count)

    // How much ink each lays down (antialiased edges included, so a thin
    // line isn't rounded to whole pixels), and where it's at least half.
    var inkTruth = 0
    var inkOurs = 0
    var inTruth = 0
    var inOurs = 0
    var both = 0
    for (a, b) in zip(truth, ours) {
      inkTruth += Int(a)
      inkOurs += Int(b)
      let t = a >= 128
      let o = b >= 128
      if t { inTruth += 1 }
      if o { inOurs += 1 }
      if t && o { both += 1 }
    }
    let area = CGFloat(inkOurs) / CGFloat(max(inkTruth, 1))
    let overlap = CGFloat(both) / CGFloat(max(inTruth + inOurs - both, 1))
    print("ink \(name): area \(String(format: "%.3f", area)), overlap \(String(format: "%.3f", overlap)), pixels \(inTruth)")
    let off = Int((abs(area - 1) * 100).rounded())
    XCTAssertEqual(
      area, 1, accuracy: 0.05, "covers \(off)% \(area < 1 ? "less" : "more") than PencilKit's", file: file, line: line)
    XCTAssertGreaterThanOrEqual(overlap, 0.95, "the shapes differ", file: file, line: line)
  }

  /// PencilKit's drawing of `stroke` over `rect`: alpha, top row first.
  private func pencilKit(_ stroke: PKStroke, _ rect: CGRect) -> [UInt8]? {
    var image: CGImage?
    UITraitCollection(userInterfaceStyle: .light).performAsCurrent {
      image = PKDrawing(strokes: [stroke]).image(from: rect, scale: scale).cgImage
    }
    guard let image else { return nil }
    return alpha(width: Int(rect.width * scale), height: Int(rect.height * scale)) { context in
      context.draw(image, in: CGRect(x: 0, y: 0, width: context.width, height: context.height))
    }
  }

  /// `InkOutline`'s drawing, as a PDF page (as it's written into a PDF's
  /// stamp), drawn back over `rect`.
  private func outline(_ stroke: PKStroke, _ look: InkOutline.Look, _ rect: CGRect) -> [UInt8]? {
    let data = NSMutableData()
    var box = CGRect(origin: .zero, size: rect.size)
    guard let consumer = CGDataConsumer(data: data as CFMutableData),
      let pdf = CGContext(consumer: consumer, mediaBox: &box, nil)
    else { return nil }
    pdf.beginPDFPage(nil)
    // Markup space: origin top-left.
    pdf.translateBy(x: 0, y: rect.height)
    pdf.scaleBy(x: 1, y: -1)
    pdf.translateBy(x: -rect.minX, y: -rect.minY)
    InkOutline.draw(stroke, look, in: pdf)
    pdf.endPDFPage()
    pdf.closePDF()
    guard let provider = CGDataProvider(data: data), let page = CGPDFDocument(provider)?.page(at: 1) else { return nil }
    return alpha(width: Int(rect.width * scale), height: Int(rect.height * scale)) { context in
      context.scaleBy(x: scale, y: scale)
      context.drawPDFPage(page)
    }
  }

  private func alpha(width: Int, height: Int, _ draw: (CGContext) -> Void) -> [UInt8]? {
    var pixels = [UInt8](repeating: 0, count: width * height)
    let drawn = pixels.withUnsafeMutableBytes { buffer -> Bool in
      guard
        let context = CGContext(
          data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width,
          space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.alphaOnly.rawValue)
      else { return false }
      draw(context)
      return true
    }
    return drawn ? pixels : nil
  }
}
