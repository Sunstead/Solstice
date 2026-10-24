import PDFKit
import PaperKit
import UIKit
import XCTest

@testable import tauri_plugin_solstice_native

/// What a surface holds on to: the canvases it puts under the app's view
/// controller, and which of a PDF's page canvases stay its own.
@MainActor
final class SurfaceLifetimeTests: XCTestCase {
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

  private func drawing(_ id: String) -> DrawingSurface {
    DrawingSurface(id: id, path: folder.appendingPathComponent("\(id).drawing.svg").path, plugin: plugin)
  }

  // -- Closing --------------------------------------------------------------

  /// A closed drawing's canvas stayed under the app's view controller, with
  /// its whole drawing, for as long as the app ran.
  func testClosingADrawingLetsItsCanvasGo() async {
    let host = SurfaceHost(frame: CGRect(x: 0, y: 0, width: 800, height: 600))
    let surface = drawing("a")
    host.add(surface)
    await surface.shown()
    XCTAssertEqual(parent.children.count, 1)
    host.remove("a")
    XCTAssertEqual(parent.children.count, 0)
  }

  func testOpeningOverASurfaceLetsTheOldOneGo() async {
    let host = SurfaceHost(frame: CGRect(x: 0, y: 0, width: 800, height: 600))
    let first = drawing("a")
    host.add(first)
    await first.shown()
    let second = drawing("a")
    host.add(second)
    await second.shown()
    XCTAssertEqual(parent.children.count, 1)
  }

  /// A drawing that couldn't be read was a blank canvas, saved over the file.
  func testAnUnreadableDrawingIsNeverSavedOver() async throws {
    let url = folder.appendingPathComponent("broken.drawing.svg")
    let broken = #"<svg><metadata><solstice:paper version="2" encoding="deflate">bm90IGRlZmxhdGVk</solstice:paper></metadata></svg>"#
    try broken.write(to: url, atomically: true, encoding: .utf8)
    let surface = DrawingSurface(id: "b", path: url.path, plugin: plugin)
    await surface.shown()
    await flush(surface)
    XCTAssertEqual(try String(contentsOf: url, encoding: .utf8), broken)
  }

  // -- A PDF's page canvases ------------------------------------------------

  private func notebook() async throws -> (PdfSurface, PDFPage) {
    let url = folder.appendingPathComponent("notebook.pdf")
    try Notebook.create(at: url, template: "lined")
    let surface = PdfSurface(id: "p", path: url.path, plugin: plugin)
    for _ in 0..<200 {
      if let page = surface.pdfView.document?.page(at: 0) { return (surface, page) }
      try await Task.sleep(for: .milliseconds(10))
    }
    throw XCTSkip("The notebook didn't open.")
  }

  private func flush(_ surface: SurfaceView) async {
    await withCheckedContinuation { done in surface.flush { done.resume() } }
  }

  /// The stuck tools: a page saved while PDFKit still showed it (just off
  /// screen) lost its canvas, so the canvas on the page took no new tools and
  /// what was drawn on it was never saved.
  func testACanvasPDFKitStillShowsStaysTheSurfaces() async throws {
    let (surface, page) = try await notebook()
    let key = ObjectIdentifier(page)
    let overlay = try XCTUnwrap(surface.pdfView(surface.pdfView, overlayViewFor: page))
    let controller = try XCTUnwrap(surface.canvases[key]?.controller)
    surface.paperMarkupViewControllerDidChangeMarkup(controller)
    await flush(surface)
    XCTAssertTrue(surface.canvases[key]?.controller === controller)

    surface.pdfView(surface.pdfView, willEndDisplayingOverlayView: overlay, for: page)
    XCTAssertNil(surface.canvases[key])
  }

  func testACanvasWhosePageWentWhileUnsavedGoesOnceSaved() async throws {
    let (surface, page) = try await notebook()
    let key = ObjectIdentifier(page)
    let overlay = try XCTUnwrap(surface.pdfView(surface.pdfView, overlayViewFor: page))
    let controller = try XCTUnwrap(surface.canvases[key]?.controller)
    surface.paperMarkupViewControllerDidChangeMarkup(controller)
    surface.pdfView(surface.pdfView, willEndDisplayingOverlayView: overlay, for: page)
    XCTAssertNotNil(surface.canvases[key])
    await flush(surface)
    XCTAssertNil(surface.canvases[key])
  }
}
