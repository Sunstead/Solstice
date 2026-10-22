import XCTest

@testable import SurfaceCore

final class PageCanvasesTests: XCTestCase {
  /// The stuck tools: a page saved while just off screen lost its canvas,
  /// but PDFKit still showed it, so it took no new tools and saved nothing.
  func testACanvasPDFKitStillShowsIsKeptAfterItsSave() {
    var canvases = PageCanvases<Int>()
    canvases.shown(2)
    XCTAssertEqual(canvases.afterSave([2], unsaved: []), [])
  }

  func testOneWhosePageWentWhileUnsavedGoesOnceSaved() {
    var canvases = PageCanvases<Int>()
    canvases.shown(2)
    XCTAssertFalse(canvases.ended(2, unsaved: true))
    XCTAssertEqual(canvases.afterSave([2], unsaved: []), [2])
  }

  func testOneStillUnsavedAfterTheSaveIsKept() {
    var canvases = PageCanvases<Int>()
    canvases.shown(2)
    _ = canvases.ended(2, unsaved: true)
    // Marked again while the save was under way.
    XCTAssertEqual(canvases.afterSave([2], unsaved: [2]), [])
  }

  func testOneWithNothingUnsavedGoesWithItsPage() {
    var canvases = PageCanvases<Int>()
    canvases.shown(2)
    XCTAssertTrue(canvases.ended(2, unsaved: false))
  }

  func testShownAgainBeforeTheSaveIsKept() {
    var canvases = PageCanvases<Int>()
    canvases.shown(2)
    _ = canvases.ended(2, unsaved: true)
    canvases.shown(2)
    XCTAssertEqual(canvases.afterSave([2], unsaved: []), [])
  }
}
