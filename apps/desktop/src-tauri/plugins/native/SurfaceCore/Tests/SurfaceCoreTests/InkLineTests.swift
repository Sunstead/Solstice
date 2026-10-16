import Foundation
import XCTest

@testable import SurfaceCore

/// A repeatable sequence in 0..<1.
private struct Noise {
  var state: UInt64 = 0x9E37_79B9_7F4A_7C15
  mutating func next() -> CGFloat {
    state = state &* 6_364_136_223_846_793_005 &+ 1_442_695_040_888_963_407
    return CGFloat(state >> 11) / CGFloat(1 << 53)
  }
}

/// `count` points 1.5 apart round a circle of `radius`: handwriting's bends.
private func arc(_ count: Int, radius: CGFloat = 6) -> [CGPoint] {
  (0..<count).map { i in
    let angle = CGFloat(i) * 1.5 / radius
    return CGPoint(x: radius * cos(angle), y: radius * sin(angle))
  }
}

final class InkLineTests: XCTestCase {
  // -- Smoothness --

  /// Where one run ends and the next begins, the curve keeps its direction:
  /// the control points either side of the shared point are in line with it.
  func testRunsMeetWithoutAKink() {
    let points = arc(80)
    // Pressing harder along the stroke: the width steps many times.
    let radii = (0..<80).map { 0.6 + CGFloat($0) / 80 }
    let runs = InkLine.runs(Array(zip(points, radii)).map { (point: $0, radius: $1) })
    XCTAssertGreaterThan(runs.count, 3)
    for (before, after) in zip(runs, runs.dropFirst()) {
      let joint = after.start
      let incoming = before.segments.last!.control2
      let outgoing = after.segments.first!.control1
      XCTAssertEqual(before.segments.last!.to, joint)
      let a = CGPoint(x: joint.x - incoming.x, y: joint.y - incoming.y)
      let b = CGPoint(x: outgoing.x - joint.x, y: outgoing.y - joint.y)
      let sine = (a.x * b.y - a.y * b.x) / (hypot(a.x, a.y) * hypot(b.x, b.y))
      XCTAssertLessThan(abs(sine), 0.01, "the curve turns \(asin(abs(sine)) * 180 / .pi)° at a run's end")
    }
  }

  /// A steady hand reads a little differently at every point; that noise
  /// mustn't cut the line into runs of a few points each.
  func testNoisyReadingsGiveLongRuns() {
    var noise = Noise()
    let count = 200
    let points = (0..<count).map { CGPoint(x: CGFloat($0) * 1.5, y: 0) }
    let read = (0..<count).map { _ in (1 + (noise.next() - 0.5) * 0.2, 1 + (noise.next() - 0.5) * 0.2) }
    let radii = InkLine.read(read, sizes: Array(repeating: 2, count: count))
    let runs = InkLine.runs(Array(zip(points, radii)).map { (point: $0, radius: $1) })
    let mean = CGFloat(count) / CGFloat(runs.count)
    XCTAssertGreaterThan(mean, 10, "\(runs.count) runs for \(count) points")
  }

  func testADotIsOneRunOfNoLength() {
    let runs = InkLine.runs([(point: CGPoint(x: 3, y: 4), radius: 1.5)])
    XCTAssertEqual(runs.count, 1)
    XCTAssertTrue(runs[0].segments.isEmpty)
    XCTAssertEqual(runs[0].width, 3)
  }

  // -- Width --

  /// Each point read the same both sides, `count` times.
  private func sides(_ one: CGFloat, _ other: CGFloat, _ count: Int) -> [(CGFloat, CGFloat)] {
    Array(repeating: (one, other), count: count)
  }

  private func read(_ sides: [(CGFloat, CGFloat)]) -> [CGFloat] {
    InkLine.read(sides, sizes: Array(repeating: 2, count: sides.count))
  }

  /// PencilKit's ink needn't sit exactly on the line: its whole width.
  func testAnOffCentreLineReadsItsWholeWidth() {
    XCTAssertEqual(read(sides(1.2, 0.8, 40))[20], 1.0, accuracy: 0.001)
  }

  /// A tenth of a point off is a large share of a thin line, and still only
  /// that.
  func testAThinOffCentreLineReadsItsWholeWidth() {
    XCTAssertEqual(read(sides(0.5, 0.3, 40))[20], 0.4, accuracy: 0.001)
  }

  /// In a small loop one side runs into the other arm all the way round:
  /// the other side alone.
  func testAnArmAlongsideIsLeftOut() {
    XCTAssertEqual(read(sides(1.0, 3.0, 40))[20], 1.0, accuracy: 0.001)
    XCTAssertEqual(read(sides(3.0, 1.0, 40))[20], 1.0, accuracy: 0.001)
    // A thin line's arms touch: a width further.
    XCTAssertEqual(read(sides(0.4, 1.2, 40))[20], 0.4, accuracy: 0.001)
  }

  /// Where the line crosses itself both sides read on for a moment: the
  /// width nearby stands in.
  func testACrossingTakesItsNeighboursWidth() {
    var sides = self.sides(1, 1, 60)
    sides[45] = (2.8, 2.9)
    XCTAssertEqual(read(sides)[45], 1, accuracy: 0.05)
  }

  /// Pressing hard for part of a stroke draws it wider there, and stays so.
  func testAPressedStretchKeepsItsWidth() {
    let line = read(sides(0.5, 0.5, 140) + sides(1.2, 1.2, 60))
    XCTAssertEqual(line[170], 1.2, accuracy: 0.06)
    XCTAssertEqual(line[60], 0.5, accuracy: 0.03)
  }

  /// A point that read nothing takes its neighbours' width.
  func testAnUnreadPointTakesItsNeighboursWidth() {
    var sides = self.sides(1, 1, 60)
    sides[40] = (0, 0)
    XCTAssertEqual(read(sides)[40], 1, accuracy: 0.05)
  }

  func testALineThatCouldntBeReadUsesItsSizes() {
    XCTAssertEqual(InkLine.read(sides(0, 0, 3), sizes: [2, 2, 2]), Array(repeating: 2 * InkLine.usualShare, count: 3))
  }
}
