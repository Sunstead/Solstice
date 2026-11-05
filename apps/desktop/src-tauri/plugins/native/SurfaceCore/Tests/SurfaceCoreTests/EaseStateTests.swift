import Foundation

#if canImport(CoreGraphics)
  import CoreGraphics
#endif
import XCTest

@testable import SurfaceCore

final class EaseStateTests: XCTestCase {
  let small = CGSize(width: 700, height: 760)
  let large = CGSize(width: 1000, height: 800)

  func testANewSizeBeginsAHoldAtTheLargerOfTheTwo() {
    var ease = EaseState()
    XCTAssertEqual(ease.hold(from: small, to: large), .began)
    XCTAssertEqual(ease.phase, .held)
    XCTAssertEqual(ease.from, small)
    XCTAssertEqual(ease.size, large)
    XCTAssertEqual(ease.target, large)
  }

  func testTheSameSizeOrNoneHoldsNothing() {
    var ease = EaseState()
    XCTAssertEqual(ease.hold(from: small, to: small), .none)
    XCTAssertEqual(ease.hold(from: CGSize(), to: large), .none)
    XCTAssertEqual(ease.hold(from: small, to: large, canBegin: false), .none)
    XCTAssertFalse(ease.isHeld)
  }

  /// Flexlayout lays a pane out a frame late: the hold can begin at a size
  /// between the two, and the view must still cover the pane's last.
  func testAReholdKeepsTheUnionOfEverySize() {
    var ease = EaseState()
    let between = CGSize(width: 700, height: 800)
    _ = ease.hold(from: small, to: between)
    XCTAssertEqual(ease.hold(from: between, to: large), .kept(grew: true, interrupted: false))
    XCTAssertEqual(ease.size, large)
    XCTAssertEqual(ease.hold(from: large, to: small), .kept(grew: false, interrupted: false))
    XCTAssertEqual(ease.size, large)
    XCTAssertEqual(ease.target, small)
    XCTAssertEqual(ease.from, small)
  }

  func testOnlyTheOriginMovingChangesNothing() {
    var ease = EaseState()
    _ = ease.hold(from: small, to: large)
    _ = ease.play()
    XCTAssertEqual(ease.hold(from: large, to: large), .kept(grew: false, interrupted: false))
    XCTAssertEqual(ease.phase, .playing)
  }

  func testPlayStartsAHoldAndRestartsOneAlreadyPlaying() {
    var ease = EaseState()
    XCTAssertEqual(ease.play(), .none)
    _ = ease.hold(from: small, to: large)
    XCTAssertEqual(ease.play(), .start)
    XCTAssertEqual(ease.play(), .restart)
    XCTAssertEqual(ease.phase, .playing)
  }

  /// A new switch while one plays: the content stops where it is, held
  /// until the page's next motion plays it on from there.
  func testANewSizeWhilePlayingInterrupts() {
    var ease = EaseState()
    _ = ease.hold(from: small, to: large)
    _ = ease.play()
    XCTAssertEqual(ease.hold(from: large, to: small), .kept(grew: false, interrupted: true))
    XCTAssertEqual(ease.phase, .held)
    XCTAssertEqual(ease.play(), .restart)
  }

  func testEndTakesTheLatestSizeAfterTheLastPlay() {
    var ease = EaseState()
    _ = ease.hold(from: small, to: large)
    _ = ease.play()
    _ = ease.hold(from: large, to: small)
    _ = ease.play()
    _ = ease.hold(from: small, to: large)
    _ = ease.play()
    XCTAssertEqual(ease.end(), large)
    XCTAssertFalse(ease.isHeld)
    XCTAssertNil(ease.end())
    XCTAssertEqual(ease.play(), .none)
  }

  func testAHoldAfterAnEndBeginsAfresh() {
    var ease = EaseState()
    _ = ease.hold(from: small, to: large)
    _ = ease.end()
    XCTAssertEqual(ease.hold(from: large, to: small), .began)
    XCTAssertEqual(ease.from, large)
    XCTAssertEqual(ease.size, large)
  }
}
