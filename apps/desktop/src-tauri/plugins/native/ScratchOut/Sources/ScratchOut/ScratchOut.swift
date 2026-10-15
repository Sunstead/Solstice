import Foundation

/// Scratching out ink, as iPadOS scratches out text: a quick back-and-forth
/// over strokes erases them. PencilKit and PaperKit have nothing for ink, so
/// this is the geometry: whether a stroke is a scratch-out (`isScratch`),
/// and which strokes it covers (`covered`). Points are a stroke's samples in
/// order, in any one coordinate space.
public enum ScratchOut {
  /// Full sweeps (each at least half the scribble's length) it takes.
  static let minimumSweeps = 5
  /// How far a sweep may bow from its chord, against its length: a line's
  /// is near nothing, a circle's half, a cursive loop's about a third.
  static let maximumBow: CGFloat = 0.25
  /// How far the scribble may move sideways each sweep, against a sweep's
  /// length: a scribble packs its sweeps, writing (mmm) spaces them.
  static let maximumDrift: CGFloat = 0.45

  /// Whether `points` go back and forth over the same small area: five or
  /// more nearly straight sweeps, close together. Tried along the stroke's
  /// long axis and across it, as some scratch along a word, some up and down.
  public static func isScratch(_ points: [CGPoint]) -> Bool {
    guard points.count >= 8, let (major, minor) = axes(of: points) else { return false }
    return sweeps(of: points, along: major, across: minor) || sweeps(of: points, along: minor, across: major)
  }

  /// The indices of `strokes` the scratch covers: those with at least half
  /// their points in the area it scribbles over, `reach` around it (about
  /// the nib's width). A stroke it only crosses is left.
  public static func covered(by scratch: [CGPoint], reach: CGFloat, strokes: [[CGPoint]]) -> [Int] {
    let hull = convexHull(scratch)
    guard hull.count >= 3 else { return [] }
    return strokes.indices.filter { i in
      let points = strokes[i]
      guard !points.isEmpty else { return false }
      let inside = points.filter { contains(hull, $0, reach: reach) }.count
      return inside * 2 >= points.count
    }
  }

  // -- Sweeps --

  /// The scribble's long and short axes: its points' principal directions.
  static func axes(of points: [CGPoint]) -> (CGVector, CGVector)? {
    let n = CGFloat(points.count)
    let mx = points.reduce(0) { $0 + $1.x } / n
    let my = points.reduce(0) { $0 + $1.y } / n
    var xx: CGFloat = 0, xy: CGFloat = 0, yy: CGFloat = 0
    for p in points {
      let dx = p.x - mx, dy = p.y - my
      xx += dx * dx
      xy += dx * dy
      yy += dy * dy
    }
    guard xx + yy > 0 else { return nil }
    let angle = 0.5 * atan2(2 * xy, xx - yy)
    let major = CGVector(dx: cos(angle), dy: sin(angle))
    return (major, CGVector(dx: -major.dy, dy: major.dx))
  }

  /// Whether the points sweep back and forth along `axis` enough, straight
  /// enough and close enough together across it.
  static func sweeps(of points: [CGPoint], along axis: CGVector, across side: CGVector) -> Bool {
    let s = points.map { $0.x * axis.dx + $0.y * axis.dy }
    let t = points.map { $0.x * side.dx + $0.y * side.dy }
    guard let low = s.min(), let high = s.max() else { return false }
    let extent = high - low
    guard extent > 0 else { return false }

    // Where it turns: a reversal counts once it has come back further than
    // a hand's jitter.
    let tolerance = max(3, extent * 0.08)
    var turns = [0]
    var extreme = 0
    var direction: CGFloat = 0
    for i in 1..<s.count {
      let moved = s[i] - s[extreme]
      if direction == 0 {
        if abs(moved) > tolerance { direction = moved > 0 ? 1 : -1; extreme = i }
      } else if (s[i] - s[extreme]) * direction > 0 {
        extreme = i
      } else if (s[extreme] - s[i]) * direction > tolerance {
        turns.append(extreme)
        direction = -direction
        extreme = i
      }
    }
    turns.append(s.count - 1)

    // The sweeps that cross most of it.
    var full: [(from: Int, to: Int)] = []
    for (a, b) in zip(turns, turns.dropFirst()) where abs(s[b] - s[a]) >= extent / 2 {
      full.append((a, b))
    }
    guard full.count >= minimumSweeps else { return false }

    let bows = full.map { bow(points, from: $0.from, to: $0.to) }.sorted()
    guard bows[bows.count / 2] <= maximumBow else { return false }

    let across = (t.max() ?? 0) - (t.min() ?? 0)
    return across / CGFloat(full.count) <= maximumDrift * extent
  }

  /// How far the points between `from` and `to` stray from the chord joining
  /// them, against its length.
  static func bow(_ points: [CGPoint], from: Int, to: Int) -> CGFloat {
    let a = points[from], b = points[to]
    let length = hypot(b.x - a.x, b.y - a.y)
    guard length > 0 else { return 1 }
    var furthest: CGFloat = 0
    for p in points[from...to] {
      furthest = max(furthest, abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / length)
    }
    return furthest / length
  }

  // -- The area it covers --

  /// The convex hull, anticlockwise (Andrew's monotone chain).
  static func convexHull(_ points: [CGPoint]) -> [CGPoint] {
    let sorted = points.sorted { ($0.x, $0.y) < ($1.x, $1.y) }
    guard sorted.count >= 3 else { return sorted }
    func cross(_ o: CGPoint, _ a: CGPoint, _ b: CGPoint) -> CGFloat {
      (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
    }
    var lower: [CGPoint] = []
    for p in sorted {
      while lower.count >= 2, cross(lower[lower.count - 2], lower[lower.count - 1], p) <= 0 { lower.removeLast() }
      lower.append(p)
    }
    var upper: [CGPoint] = []
    for p in sorted.reversed() {
      while upper.count >= 2, cross(upper[upper.count - 2], upper[upper.count - 1], p) <= 0 { upper.removeLast() }
      upper.append(p)
    }
    return Array(lower.dropLast() + upper.dropLast())
  }

  /// Whether `p` is in the anticlockwise convex `hull` or within `reach` of it.
  static func contains(_ hull: [CGPoint], _ p: CGPoint, reach: CGFloat) -> Bool {
    var inside = true
    for (i, a) in hull.enumerated() {
      let b = hull[(i + 1) % hull.count]
      if (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) < 0 { inside = false }
    }
    if inside { return true }
    for (i, a) in hull.enumerated() where distance(p, a, hull[(i + 1) % hull.count]) <= reach { return true }
    return false
  }

  /// The distance from `p` to the segment `a`–`b`.
  static func distance(_ p: CGPoint, _ a: CGPoint, _ b: CGPoint) -> CGFloat {
    let dx = b.x - a.x, dy = b.y - a.y
    let squared = dx * dx + dy * dy
    let t = squared > 0 ? max(0, min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / squared)) : 0
    return hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
  }
}
