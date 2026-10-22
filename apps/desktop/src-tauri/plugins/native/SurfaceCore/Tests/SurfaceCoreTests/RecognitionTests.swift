import Foundation
import XCTest

@testable import SurfaceCore

final class RecognitionTests: XCTestCase {
  private let start = Date(timeIntervalSince1970: 1000)

  /// Opening a drawing and leaving it rewrote (and synced) it.
  func testNothingIsDueUntilSomethingChanges() {
    let recognition = Recognition()
    XCTAssertFalse(recognition.isDue(now: start, final: true))
  }

  func testTheFirstSaveRecognises() {
    var recognition = Recognition()
    recognition.changed()
    XCTAssertTrue(recognition.isDue(now: start, final: false))
  }

  /// Recognising the whole canvas took about half a second of every save.
  func testSavesSoonAfterReuseTheText() {
    var recognition = Recognition()
    recognition.changed()
    recognition.recognised("hello", of: recognition.generation, at: start)
    recognition.changed()
    XCTAssertFalse(recognition.isDue(now: start.addingTimeInterval(10), final: false))
    XCTAssertTrue(recognition.isDue(now: start.addingTimeInterval(Recognition.interval), final: false))
  }

  func testAFinalSaveRecognisesWhatChanged() {
    var recognition = Recognition()
    recognition.changed()
    recognition.recognised("hello", of: recognition.generation, at: start)
    XCTAssertFalse(recognition.isDue(now: start.addingTimeInterval(1), final: true))
    recognition.changed()
    XCTAssertTrue(recognition.isDue(now: start.addingTimeInterval(1), final: true))
  }

  func testAChangeDuringRecognitionStaysDue() {
    var recognition = Recognition()
    recognition.changed()
    let asked = recognition.generation
    recognition.changed()
    recognition.recognised("hel", of: asked, at: start)
    XCTAssertTrue(recognition.isDue(now: start.addingTimeInterval(1), final: true))
  }
}
