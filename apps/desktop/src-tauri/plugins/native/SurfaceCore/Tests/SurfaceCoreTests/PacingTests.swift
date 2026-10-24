import Foundation
import XCTest

@testable import SurfaceCore

final class PacingTests: XCTestCase {
  func testQuickWorkWaitsTheLeast() {
    var pacing = Pacing(least: 3, most: 30)
    XCTAssertEqual(pacing.wait, 3)
    pacing.took(0.1)
    XCTAssertEqual(pacing.wait, 3)
  }

  /// A save that takes a second waits ten: a tenth of the time at most.
  func testSlowWorkWaitsInProportion() {
    var pacing = Pacing(least: 3, most: 30)
    pacing.took(1)
    XCTAssertEqual(pacing.wait, 10, accuracy: 0.001)
  }

  func testNoWaitPassesTheMost() {
    var pacing = Pacing(least: 3, most: 30)
    pacing.took(12)
    XCTAssertEqual(pacing.wait, 30)
  }
}
