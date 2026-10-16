import Dispatch
import Foundation
import XCTest

@testable import SurfaceCore

/// Stops the run if `done` isn't set within `seconds`: a save spinning on the
/// main actor would block the test's own timeout.
private func watchdog(_ seconds: Double, _ done: @escaping @Sendable () -> Bool) {
  DispatchQueue.global().asyncAfter(deadline: .now() + seconds) {
    if !done() { fatalError("saves didn't finish within \(seconds) s: one is spinning on the main actor") }
  }
}

private final class Flag: @unchecked Sendable {
  private let lock = NSLock()
  private var value = false
  func set() {
    lock.lock()
    value = true
    lock.unlock()
  }
  var isSet: Bool {
    lock.lock()
    defer { lock.unlock() }
    return value
  }
}

@MainActor
final class SavesTests: XCTestCase {
  /// The freeze: a save asked for at a higher priority than the one under
  /// way resumed first when it ended, and spun on the finished task.
  func testAHigherPrioritySaveWaitingOnALowerOneFinishes() async {
    let saves = Saves()
    let finished = Flag()
    watchdog(5) { finished.isSet }

    let first = Task(priority: .utility) { @MainActor in
      await saves.run { try? await Task.sleep(for: .milliseconds(100)) }
    }
    try? await Task.sleep(for: .milliseconds(20))
    let second = Task(priority: .userInitiated) { @MainActor in
      await saves.run {}
    }
    await first.value
    await second.value
    finished.set()
    XCTAssertFalse(saves.running)
  }

  func testSavesNeverOverlap() async {
    let saves = Saves()
    var log: [String] = []
    let finished = Flag()
    watchdog(5) { finished.isSet }

    let tasks = (0..<4).map { i in
      Task(priority: i.isMultiple(of: 2) ? .utility : .userInitiated) { @MainActor in
        await saves.run {
          log.append("start \(i)")
          try? await Task.sleep(for: .milliseconds(30))
          log.append("end \(i)")
        }
      }
    }
    // Each asks in turn, while the one before it is still running.
    for task in tasks { await task.value }
    finished.set()

    XCTAssertEqual(log.count, 8)
    for pair in stride(from: 0, to: log.count, by: 2) {
      let started = log[pair].dropFirst("start ".count)
      XCTAssertEqual(log[pair + 1], "end \(started)", "a save began before the one before it ended: \(log)")
    }
    XCTAssertFalse(saves.running)
  }

  func testASaveAskedForDuringOneRunsAfterIt() async {
    let saves = Saves()
    var log: [String] = []
    let finished = Flag()
    watchdog(5) { finished.isSet }

    let first = Task { @MainActor in
      await saves.run {
        log.append("first")
        try? await Task.sleep(for: .milliseconds(50))
      }
    }
    try? await Task.sleep(for: .milliseconds(10))
    XCTAssertTrue(saves.running)
    await saves.run { log.append("second") }
    await first.value
    finished.set()

    XCTAssertEqual(log, ["first", "second"])
    XCTAssertFalse(saves.running)
  }
}
