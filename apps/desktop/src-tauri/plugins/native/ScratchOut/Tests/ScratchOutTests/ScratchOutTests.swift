import Foundation
import XCTest

@testable import ScratchOut

/// Points every `step` along straight lines through `corners`.
private func polyline(_ corners: [CGPoint], step: CGFloat = 2) -> [CGPoint] {
  var points = [corners[0]]
  for (a, b) in zip(corners, corners.dropFirst()) {
    let length = hypot(b.x - a.x, b.y - a.y)
    let n = max(1, Int(length / step))
    for i in 1...n {
      let t = CGFloat(i) / CGFloat(n)
      points.append(CGPoint(x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t))
    }
  }
  return points
}

/// A curve sampled at `n` points.
private func curve(_ n: Int = 400, _ f: (CGFloat) -> CGPoint) -> [CGPoint] {
  (0...n).map { f(CGFloat($0) / CGFloat(n)) }
}

/// Back and forth `sweeps` times across `width`, drifting down `drift` a sweep.
private func zigzag(at origin: CGPoint, width: CGFloat, sweeps: Int, drift: CGFloat) -> [CGPoint] {
  polyline((0...sweeps).map { i in
    CGPoint(x: origin.x + (i.isMultiple(of: 2) ? 0 : width), y: origin.y + CGFloat(i) * drift)
  })
}

final class ScratchOutTests: XCTestCase {
  // -- What counts as scratching out --

  func testBackAndForthAcross() {
    XCTAssertTrue(ScratchOut.isScratch(zigzag(at: .zero, width: 100, sweeps: 8, drift: 3)))
  }

  func testUpAndDownAlongAWord() {
    // Over a word: short strokes up and down, moving right, as many draw it.
    let points = polyline((0...12).map { i in CGPoint(x: CGFloat(i) * 9, y: i.isMultiple(of: 2) ? 0 : 30) })
    XCTAssertTrue(ScratchOut.isScratch(points))
  }

  func testSlantedAndUneven() {
    // A hand's: tilted, sweeps of uneven length, a little wobble.
    let angle = CGFloat.pi / 7
    let corners = (0...9).map { i -> CGPoint in
      let x: CGFloat = i.isMultiple(of: 2) ? CGFloat(i % 3) * 4 : 90 + CGFloat(i % 4) * 5
      let y = CGFloat(i) * 4 + (i.isMultiple(of: 3) ? 2 : -1)
      return CGPoint(x: x * cos(angle) - y * sin(angle), y: x * sin(angle) + y * cos(angle))
    }
    XCTAssertTrue(ScratchOut.isScratch(polyline(corners)))
  }

  // -- What doesn't --

  func testAStraightLine() {
    XCTAssertFalse(ScratchOut.isScratch(polyline([.zero, CGPoint(x: 200, y: 10)])))
  }

  func testAnUnderlineThereAndBack() {
    XCTAssertFalse(ScratchOut.isScratch(zigzag(at: .zero, width: 120, sweeps: 2, drift: 2)))
  }

  func testACircle() {
    XCTAssertFalse(ScratchOut.isScratch(curve { t in
      CGPoint(x: 50 * cos(2 * .pi * t), y: 50 * sin(2 * .pi * t))
    }))
  }

  func testASpiral() {
    XCTAssertFalse(ScratchOut.isScratch(curve(800) { t in
      let r = 10 + 50 * t
      return CGPoint(x: r * cos(6 * .pi * t), y: r * sin(6 * .pi * t))
    }))
  }

  func testCursiveEs() {
    // eeee: loops moving right.
    XCTAssertFalse(ScratchOut.isScratch(curve(800) { t in
      let a = 8 * .pi * t
      return CGPoint(x: 12 * a - 18 * sin(a), y: -15 * (1 - cos(a)))
    }))
  }

  func testCursiveMs() {
    // mmmm: humps as tall as they're wide apart.
    XCTAssertFalse(ScratchOut.isScratch(curve(800) { t in
      let a = 12 * .pi * t
      return CGPoint(x: 6 * a, y: -30 * abs(sin(a / 2)))
    }))
  }

  func testTooFewPoints() {
    XCTAssertFalse(ScratchOut.isScratch([.zero, CGPoint(x: 1, y: 1)]))
  }

  // -- What it erases --

  func testErasesTheStrokesItCovers() {
    let scratch = zigzag(at: CGPoint(x: -5, y: -5), width: 110, sweeps: 10, drift: 4)
    let word = [
      polyline([CGPoint(x: 10, y: 5), CGPoint(x: 20, y: 30)]),
      polyline([CGPoint(x: 40, y: 30), CGPoint(x: 50, y: 5), CGPoint(x: 60, y: 30)]),
      polyline([CGPoint(x: 80, y: 10), CGPoint(x: 95, y: 25)]),
    ]
    XCTAssertEqual(ScratchOut.covered(by: scratch, reach: 3, strokes: word), [0, 1, 2])
  }

  func testLeavesAStrokeItOnlyCrosses() {
    let scratch = zigzag(at: .zero, width: 100, sweeps: 8, drift: 3)
    let long = polyline([CGPoint(x: 50, y: -200), CGPoint(x: 50, y: 200)])
    XCTAssertEqual(ScratchOut.covered(by: scratch, reach: 3, strokes: [long]), [])
  }

  func testLeavesStrokesElsewhere() {
    let scratch = zigzag(at: .zero, width: 100, sweeps: 8, drift: 3)
    let away = polyline([CGPoint(x: 300, y: 300), CGPoint(x: 320, y: 310)])
    XCTAssertEqual(ScratchOut.covered(by: scratch, reach: 3, strokes: [away, []]), [])
  }

  func testReachesStrokesJustOutsideItsEdge() {
    let scratch = zigzag(at: .zero, width: 100, sweeps: 8, drift: 3)
    let edge = polyline([CGPoint(x: 5, y: -1), CGPoint(x: 60, y: -1)])
    XCTAssertEqual(ScratchOut.covered(by: scratch, reach: 3, strokes: [edge]), [0])
  }

  // -- Only what's near it --

  private func bounds(_ points: [CGPoint]) -> CGRect {
    let xs = points.map(\.x), ys = points.map(\.y)
    return CGRect(origin: CGPoint(x: xs.min()!, y: ys.min()!), size: CGSize(width: xs.max()! - xs.min()!, height: ys.max()! - ys.min()!))
  }

  /// Scratching out slowed as a drawing grew: every stroke in it was looked
  /// at, point by point, on the main thread.
  func testOnlyStrokesNearTheScratchAreLookedAt() {
    let scratch = zigzag(at: .zero, width: 100, sweeps: 8, drift: 3)
    let strokes = [
      polyline([CGPoint(x: 10, y: 5), CGPoint(x: 20, y: 30)]),
      polyline([CGPoint(x: 300, y: 300), CGPoint(x: 320, y: 310)]),
      polyline([CGPoint(x: 102, y: -50), CGPoint(x: 102, y: -2)]),
      polyline([CGPoint(x: -2000, y: 10), CGPoint(x: -1900, y: 10)]),
    ]
    XCTAssertEqual(ScratchOut.nearby(scratch, reach: 3, bounds: strokes.map(bounds)), [0, 2])
  }

  func testWhatItErasesIsTheSameForTheNearbyOnes() {
    let scratch = zigzag(at: CGPoint(x: -5, y: -5), width: 110, sweeps: 10, drift: 4)
    var strokes: [[CGPoint]] = []
    for row in 0..<20 {
      for column in 0..<20 {
        let x = CGFloat(column) * 40 - 200
        let y = CGFloat(row) * 30 - 200
        strokes.append(polyline([CGPoint(x: x, y: y), CGPoint(x: x + 12, y: y + 20)]))
      }
    }
    let near = ScratchOut.nearby(scratch, reach: 3, bounds: strokes.map(bounds))
    XCTAssertLessThan(near.count, strokes.count / 10)
    let all = ScratchOut.covered(by: scratch, reach: 3, strokes: strokes)
    let found = ScratchOut.covered(by: scratch, reach: 3, strokes: near.map { strokes[$0] }).map { near[$0] }
    XCTAssertFalse(all.isEmpty)
    XCTAssertEqual(found, all)
  }
}
