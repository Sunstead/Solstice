import PencilKit
import SurfaceCore
import UIKit
import XCTest

@testable import tauri_plugin_solstice_native

/// The ribbon's slot in hand (`ToolSpec`) as the PencilKit tool every canvas
/// draws with (`Ink.tool(for:)`).
@MainActor
final class InkToolTests: XCTestCase {
  private func spec(_ kind: ToolSpec.Kind, width: Double = 5, opacity: Double = 1, eraser: ToolSpec.EraserMode = .vector) -> ToolSpec {
    ToolSpec(kind: kind, red: 1, green: 0, blue: 0, width: width, opacity: opacity, eraser: eraser)
  }

  func testAnInkKeepsItsTypeColourAndOpacity() throws {
    let tool = try XCTUnwrap(Ink.tool(for: spec(.marker, width: 20, opacity: 0.5)) as? PKInkingTool)
    XCTAssertEqual(tool.inkType, .marker)
    var (r, a): (CGFloat, CGFloat) = (0, 0)
    tool.color.getRed(&r, green: nil, blue: nil, alpha: &a)
    XCTAssertEqual(r, 1, accuracy: 0.01)
    XCTAssertEqual(a, 0.5, accuracy: 0.01)
  }

  func testAWidthStaysWithinWhatItsInkAllows() throws {
    let range = PKInkingTool.InkType.pen.validWidthRange
    let thick = try XCTUnwrap(Ink.tool(for: spec(.pen, width: 100)) as? PKInkingTool)
    XCTAssertEqual(thick.width, range.upperBound, accuracy: 0.01)
    let thin = try XCTUnwrap(Ink.tool(for: spec(.pen, width: 0.5)) as? PKInkingTool)
    XCTAssertEqual(thin.width, max(0.5, range.lowerBound), accuracy: 0.01)
  }

  func testErasersAndTheLasso() throws {
    // A pixel eraser given a width is PencilKit's fixed-width one.
    XCTAssertEqual(
      try XCTUnwrap(Ink.tool(for: spec(.eraser, eraser: .bitmap)) as? PKEraserTool).eraserType, .fixedWidthBitmap)
    XCTAssertEqual(try XCTUnwrap(Ink.tool(for: spec(.eraser)) as? PKEraserTool).eraserType, .vector)
    XCTAssertTrue(Ink.tool(for: spec(.lasso)) is PKLassoTool)
  }
}
