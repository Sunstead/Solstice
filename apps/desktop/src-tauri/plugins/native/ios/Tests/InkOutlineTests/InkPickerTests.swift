import UIKit
import XCTest

@testable import tauri_plugin_solstice_native

/// The picker reads its colours the way the canvases do (`Paper`): on white
/// paper, black ink's swatch is black whatever the system's appearance. The
/// dark paper cases are in `DarkPaperTests`.
@MainActor
final class InkPickerTests: XCTestCase {
  func testThePickerShowsColoursAsOnPaper() {
    XCTAssertEqual(Ink.shared.picker.colorUserInterfaceStyle, .light)
  }
}
