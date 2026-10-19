import Foundation
import XCTest

@testable import SurfaceCore

final class ToolSpecTests: XCTestCase {
  private func decode(_ json: String) throws -> ToolSpec {
    try JSONDecoder().decode(ToolSpec.self, from: Data(json.utf8))
  }

  func testReadsWhatTheWebSends() throws {
    let spec = try decode(##"{"kind":"marker","color":"#ff8000","width":20,"opacity":0.5,"eraser":"vector"}"##)
    XCTAssertEqual(spec.kind, .marker)
    XCTAssertEqual(spec.red, 1, accuracy: 0.001)
    XCTAssertEqual(spec.green, 128.0 / 255, accuracy: 0.001)
    XCTAssertEqual(spec.blue, 0, accuracy: 0.001)
    XCTAssertEqual(spec.width, 20)
    XCTAssertEqual(spec.opacity, 0.5)
    XCTAssertEqual(spec.eraser, .vector)
  }

  func testEveryKindTheWebHas() throws {
    for kind in ["pen", "monoline", "fountainPen", "marker", "pencil", "crayon", "watercolor", "reed", "eraser", "lasso"] {
      XCTAssertEqual(try decode(##"{"kind":"\##(kind)"}"##).kind.rawValue, kind)
    }
  }

  func testRepairsWhatItCannotUse() throws {
    let spec = try decode(##"{"kind":"laser","color":"blue","width":-3,"opacity":9,"eraser":"wet"}"##)
    XCTAssertEqual(spec, ToolSpec.pen)
    XCTAssertEqual(try decode("{}"), ToolSpec.pen)
    XCTAssertEqual(try decode(##"{"width":1e9}"##).width, ToolSpec.widthRange.upperBound)
    XCTAssertEqual(try decode(##"{"opacity":0}"##).opacity, ToolSpec.opacityRange.lowerBound)
    XCTAssertEqual(try decode(##"{"kind":"eraser","eraser":"bitmap"}"##).eraser, .bitmap)
  }

  func testTheColourReadsWithOrWithoutTheHash() throws {
    XCTAssertEqual(try decode(##"{"color":"00FF00"}"##).green, 1)
    XCTAssertEqual(try decode(##"{"color":"#00ff00"}"##).green, 1)
  }

  func testRoundTripsForTheCache() throws {
    let spec = try decode(##"{"kind":"pencil","color":"#336699","width":4,"opacity":0.8,"eraser":"vector"}"##)
    let again = try JSONDecoder().decode(ToolSpec.self, from: JSONEncoder().encode(spec))
    XCTAssertEqual(again, spec)
    XCTAssertEqual(spec.hex, "#336699")
  }
}
