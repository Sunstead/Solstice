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
    XCTAssertTrue(recognition.isDue(now: start.addingTimeInterval(30), final: false))
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

  /// A huge drawing's handwriting took tens of seconds, every 30 s it was
  /// written on: it heated the iPad.
  func testSlowRecognitionWaitsLonger() {
    var recognition = Recognition()
    recognition.changed()
    recognition.recognised("hello", of: recognition.generation, at: start, took: 50)
    recognition.changed()
    XCTAssertFalse(recognition.isDue(now: start.addingTimeInterval(60), final: false))
    XCTAssertTrue(recognition.isDue(now: start.addingTimeInterval(500), final: false))
  }

  /// Leaving waits for the handwriting only when that's quick: the app has
  /// seconds to save when it goes to the background.
  func testLeavingDoesntWaitForSlowRecognition() {
    var recognition = Recognition()
    recognition.changed()
    recognition.recognised("hello", of: recognition.generation, at: start, took: 20)
    recognition.changed()
    XCTAssertFalse(recognition.isDue(now: start.addingTimeInterval(1), final: true))
  }

  /// Opened, a drawing's text is its file's: the first save doesn't
  /// recognise the whole drawing again.
  func testTheFilesTextStandsAtFirst() {
    var recognition = Recognition(text: "from the file", at: start, cost: 5)
    XCTAssertEqual(recognition.text, "from the file")
    recognition.changed()
    XCTAssertFalse(recognition.isDue(now: start.addingTimeInterval(3), final: false))
    XCTAssertTrue(recognition.isDue(now: start.addingTimeInterval(50), final: false))
    XCTAssertFalse(recognition.isDue(now: start.addingTimeInterval(3), final: true), "5 s is too long to wait when leaving")
  }
}
