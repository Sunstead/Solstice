import PDFKit
import PaperKit
import UIKit
import XCTest

@testable import tauri_plugin_solstice_native

/// A tap on the status bar scrolls whatever scroll view answers it to the top.
/// On a canvas that's a blank band far above what was drawn, and a palm or the
/// Pencil's hand lands there often, so no surface's scroll views answer it.
@MainActor
final class ScrollToTopTests: XCTestCase {
  private let parent = UIViewController()
  private var plugin: NativePlugin!
  private var folder: URL!

  override func setUp() async throws {
    plugin = NativePlugin()
    plugin.manager.viewController = parent
    folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
  }

  override func tearDown() async throws {
    plugin.manager.viewController = nil
    try? FileManager.default.removeItem(at: folder)
  }

  private func answering(_ view: UIView) -> [UIScrollView] {
    view.subviews(of: UIScrollView.self).filter(\.scrollsToTop)
  }

  func testADrawingsCanvasLeavesTheStatusBarAlone() {
    let surface = DrawingSurface(id: "d", path: folder.appendingPathComponent("d.drawing.svg").path, plugin: plugin)
    surface.frame = CGRect(x: 0, y: 0, width: 800, height: 600)
    surface.layoutIfNeeded()
    XCTAssertFalse(surface.subviews(of: UIScrollView.self).isEmpty, "the canvas has a scroll view to check")
    XCTAssertTrue(answering(surface).isEmpty)
  }

  func testAnImagesCanvasLeavesTheStatusBarAlone() throws {
    let url = folder.appendingPathComponent("i.png")
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    let png = UIGraphicsImageRenderer(size: CGSize(width: 200, height: 100), format: format)
      .pngData { context in
        UIColor.red.setFill()
        context.fill(CGRect(x: 0, y: 0, width: 200, height: 100))
      }
    try png.write(to: url)
    let surface = ImageSurface(id: "i", path: url.path, plugin: plugin)
    surface.frame = CGRect(x: 0, y: 0, width: 800, height: 600)
    surface.layoutIfNeeded()
    XCTAssertFalse(surface.subviews(of: UIScrollView.self).isEmpty, "the canvas has a scroll view to check")
    XCTAssertTrue(answering(surface).isEmpty)
  }

  func testAPDFAndItsPageCanvasesLeaveTheStatusBarAlone() async throws {
    let url = folder.appendingPathComponent("n.pdf")
    try Notebook.create(at: url, template: "lined")
    let surface = PdfSurface(id: "p", path: url.path, plugin: plugin)
    surface.frame = CGRect(x: 0, y: 0, width: 800, height: 600)
    var page: PDFPage?
    for _ in 0..<200 {
      page = surface.pdfView.document?.page(at: 0)
      if page != nil { break }
      try await Task.sleep(for: .milliseconds(10))
    }
    let first = try XCTUnwrap(page, "the notebook didn't open")
    surface.layoutIfNeeded()
    let overlay = try XCTUnwrap(surface.pdfView(surface.pdfView, overlayViewFor: first))
    XCTAssertFalse(overlay.subviews(of: UIScrollView.self).isEmpty, "the page canvas has a scroll view to check")
    XCTAssertTrue(answering(surface).isEmpty)
    XCTAssertTrue(answering(overlay).isEmpty)
  }
}
