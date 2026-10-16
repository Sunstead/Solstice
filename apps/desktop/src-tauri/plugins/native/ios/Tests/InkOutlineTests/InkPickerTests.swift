import PencilKit
import UIKit
import XCTest

@testable import tauri_plugin_solstice_native

/// The canvases are paper, always light: the picker has to show its colours
/// the same way, or in dark mode its swatch for black ink reads white.
@MainActor
final class InkPickerTests: XCTestCase {
  func testThePickerShowsColoursAsOnPaper() {
    XCTAssertEqual(Ink.shared.picker.colorUserInterfaceStyle, .light)
  }
}
