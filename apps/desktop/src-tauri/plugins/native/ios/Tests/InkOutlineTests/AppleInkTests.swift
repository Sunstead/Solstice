import PDFKit
import PaperKit
import PencilKit
import UIKit
import XCTest

@testable import tauri_plugin_solstice_native

/// Ink from Apple's Markup (Files, Preview): read from its archive, drawn
/// live, and taken into the file as Solstice's own as soon as the PDF opens,
/// so every reader shows it sharp (Apple's own copy is a 2x picture).
@MainActor
final class AppleInkTests: XCTestCase {
  private let parent = UIViewController()
  private var plugin: NativePlugin!
  private var folder: URL!

  override func setUp() async throws {
    plugin = NativePlugin()
    plugin.manager.viewController = parent
    folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    RustStandIns.state.withLock { $0 = (nil, []) }
  }

  override func tearDown() async throws {
    RustStandIns.state.withLock { $0 = (nil, []) }
    plugin.manager.viewController = nil
    try? FileManager.default.removeItem(at: folder)
  }

  /// A few strokes, in page space (origin top-left), inside `area`.
  private func drawing(in area: CGRect) -> PKDrawing {
    let strokes = (0..<3).map { (row: Int) -> PKStroke in
      let y = area.minY + CGFloat(row) * area.height / 2
      let points = (0...20).map { (i: Int) -> PKStrokePoint in
        let x = area.minX + CGFloat(i) * area.width / 20
        return PKStrokePoint(
          location: CGPoint(x: x, y: y), timeOffset: Double(i) * 0.01, size: CGSize(width: 3, height: 3),
          opacity: 1, force: 1, azimuth: 0, altitude: .pi / 2)
      }
      return PKStroke(ink: PKInk(.pen, color: .blue), path: PKStrokePath(controlPoints: points, creationDate: Date()))
    }
    return PKDrawing(strokes: strokes)
  }

  /// An `AKInkAnnotation2` archive as Apple writes one: a keyed archive whose
  /// objects include the drawing, gzipped as Markup has written it since iOS 26.
  private func archive(_ drawing: PKDrawing, gzipped: Bool) throws -> Data {
    let ink = gzipped ? try gzip(drawing.dataRepresentation()) : drawing.dataRepresentation()
    let plist: [String: Any] = [
      "$version": 100_000, "$archiver": "NSKeyedArchiver",
      "$top": ["root": 1],
      "$objects": ["$null", ["drawing": 2, "$class": 3], ink, ["$classname": "AKInkAnnotation2", "$classes": ["AKInkAnnotation2", "NSObject"]]],
    ]
    return try PropertyListSerialization.data(fromPropertyList: plist, format: .binary, options: 0)
  }

  func testApplesInkIsReadRawOrGzipped() throws {
    let page = CGRect(x: 0, y: 0, width: 612, height: 792)
    let area = CGRect(x: 100, y: 200, width: 200, height: 100)
    let drawing = drawing(in: area)
    // The annotation's rect in page space (origin bottom-left): the drawing's bounds.
    let bounds = drawing.bounds
    let rect = CGRect(x: bounds.minX, y: page.maxY - bounds.maxY, width: bounds.width, height: bounds.height)
    for gzipped in [false, true] {
      let read = try XCTUnwrap(PdfMarkup.appleInk(try archive(drawing, gzipped: gzipped), rect: rect, box: page), "gzipped: \(gzipped)")
      XCTAssertEqual(read.strokes.count, 3)
      XCTAssertEqual(read.bounds.minX, bounds.minX, accuracy: 0.5)
      XCTAssertEqual(read.bounds.minY, bounds.minY, accuracy: 0.5)
    }
  }

  /// Opening converts: the page holding Apple's ink is saved at once, without
  /// ever being scrolled to (no canvas), with Apple's annotation absorbed.
  func testOpeningAPDFTakesApplesInkIntoTheFileAtOnce() async throws {
    let url = folder.appendingPathComponent("marked.pdf")
    try Notebook.create(at: url, template: "lined")
    let drawing = drawing(in: CGRect(x: 100, y: 200, width: 200, height: 100))
    let bounds = drawing.bounds
    let box = Notebook.a4
    let rect = [bounds.minX, box.maxY - bounds.maxY, bounds.maxX, box.maxY - bounds.minY]
    let opened: [String: Any] = [
      "pages": [NSNull()],
      "apple": [[["fingerprint": "apple-1", "archive": try archive(drawing, gzipped: true).base64EncodedString(), "rect": rect]]],
      "needsRepair": false,
    ]
    let json = String(decoding: try JSONSerialization.data(withJSONObject: opened), as: UTF8.self)
    RustStandIns.state.withLock { $0.read = json }

    let surface = PdfSurface(id: "p", path: url.path, plugin: plugin)
    var saves: [String] = []
    for _ in 0..<300 where saves.isEmpty {
      try await Task.sleep(for: .milliseconds(10))
      saves = RustStandIns.state.withLock { $0.saves }
    }
    XCTAssertTrue(surface.canvases.isEmpty, "converted without a canvas")
    let request = try XCTUnwrap(saves.first, "a save on open")
    let decoded = try JSONSerialization.jsonObject(with: Data(request.utf8)) as? [String: Any]
    let edit = try XCTUnwrap((decoded?["edits"] as? [[String: Any]])?.first)
    XCTAssertEqual(edit["page"] as? Int, 0)
    XCTAssertEqual(edit["absorbed"] as? [String], ["apple-1"])
    let data = try XCTUnwrap(((edit["markup"] as? [String: Any])?["data"] as? String).flatMap { Data(base64Encoded: $0) })
    XCTAssertEqual(try PaperMarkup(dataRepresentation: data).subelements.strokes.count, 3)
  }

  // -- gzip ------------------------------------------------------------

  private func gzip(_ data: Data) throws -> Data {
    let deflated = try (data as NSData).compressed(using: .zlib) as Data
    var out = Data([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 3])
    out.append(deflated)
    var crc = crc32(data).littleEndian
    var size = UInt32(truncatingIfNeeded: data.count).littleEndian
    out.append(Data(bytes: &crc, count: 4))
    out.append(Data(bytes: &size, count: 4))
    return out
  }

  private func crc32(_ data: Data) -> UInt32 {
    var crc: UInt32 = 0xffff_ffff
    for byte in data {
      crc ^= UInt32(byte)
      for _ in 0..<8 { crc = crc & 1 == 1 ? (crc >> 1) ^ 0xedb8_8320 : crc >> 1 }
    }
    return ~crc
  }
}
