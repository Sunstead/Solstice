import Foundation

/// The geometry of a stroke's ink as `InkOutline` sweeps it: a round nib
/// along a centre line, its width following the pressure, as runs of curve
/// each stroked at one width.
public enum InkLine {
  /// A cubic Bézier from the end of what came before to `to`.
  public struct Segment {
    public var control1: CGPoint
    public var control2: CGPoint
    public var to: CGPoint
  }

  /// A stretch of line stroked at one width. No segments: a dot at `start`.
  public struct Run {
    public var start: CGPoint
    public var segments: [Segment]
    public var width: CGFloat
  }

  /// A pen draws about this share of its points' size.
  public static let usualShare: CGFloat = 0.55
  /// A run's width stays within this share of where it started.
  static let widthStep: CGFloat = 0.04
  /// How far the curve may stray from the line's points, in points: under
  /// half a pixel at 400%, for a third of the segments of one per point.
  /// Less on a thin line, whose shape it is more of (`InkOutlineTests`).
  static let tolerance: CGFloat = 0.05

  static func tolerance(width: CGFloat) -> CGFloat {
    min(tolerance, max(0.02, width * 0.035))
  }
  /// The most points one segment spans.
  static let longestSpan = 24

  /// The line (each point with its radius) cut into runs whose width stays
  /// within `widthStep`. The curve is one through the whole line, sliced:
  /// consecutive runs share a point and its tangent, so the line bends
  /// smoothly where the width steps, and their round caps meet there.
  public static func runs(_ line: [(point: CGPoint, radius: CGFloat)]) -> [Run] {
    guard let first = line.first else { return [] }
    guard line.count > 1 else { return [Run(start: first.point, segments: [], width: 2 * first.radius)] }
    let points = line.map(\.point)
    let tangents = tangents(of: points)
    var out: [Run] = []
    var start = 0
    while start < line.count - 1 {
      var end = start + 1
      let r = line[start].radius
      while end < line.count - 1, abs(line[end + 1].radius - r) <= max(r * widthStep, 0.01) { end += 1 }
      let mean = line[start...end].map(\.radius).reduce(0, +) / CGFloat(end - start + 1)
      let segments = fit(points, tangents, from: start, to: end, within: tolerance(width: 2 * mean))
      out.append(Run(start: points[start], segments: segments, width: 2 * mean))
      start = end
    }
    return out
  }

  /// A smooth curve through every point, a segment between each and the
  /// next: each point's tangent from its neighbours, scaled by the distance
  /// to the next, so it neither kinks nor overshoots where points bunch up.
  static func curve(through points: [CGPoint]) -> [Segment] {
    let tangents = tangents(of: points)
    return (0..<max(points.count - 1, 0)).map { segment(points, tangents, from: $0, to: $0 + 1) }
  }

  /// The same curve from `from` to `to`, in as few segments as stay within
  /// `tolerance` of every point between: the file had one per 1.5 pt.
  static func fit(_ points: [CGPoint], _ tangents: [CGPoint], from: Int, to: Int, within tolerance: CGFloat) -> [Segment] {
    var out: [Segment] = []
    var i = from
    while i < to {
      var j = i + 1
      var best = segment(points, tangents, from: i, to: j)
      while j < to, j + 1 - i <= longestSpan {
        let longer = segment(points, tangents, from: i, to: j + 1)
        guard fits(longer, from: points[i], through: points[(i + 1)...j], within: tolerance) else { break }
        best = longer
        j += 1
      }
      out.append(best)
      i = j
    }
    return out
  }

  /// Each point's tangent, from its neighbours.
  static func tangents(of points: [CGPoint]) -> [CGPoint] {
    points.indices.map { i in
      let a = points[max(i - 1, 0)]
      let b = points[min(i + 1, points.count - 1)]
      let length = distance(a, points[i]) + distance(points[i], b)
      return CGPoint(x: (b.x - a.x) / length, y: (b.y - a.y) / length)
    }
  }

  /// From point `from` to `to` along their tangents, its handles a third of
  /// the line between them (for neighbours, the distance between them).
  private static func segment(_ points: [CGPoint], _ tangents: [CGPoint], from: Int, to: Int) -> Segment {
    let p = points[from]
    let q = points[to]
    let h = (from..<to).reduce(0) { $0 + distance(points[$1], points[$1 + 1]) } / 3
    let t0 = tangents[from]
    let t1 = tangents[to]
    return Segment(
      control1: CGPoint(x: p.x + t0.x * h, y: p.y + t0.y * h),
      control2: CGPoint(x: q.x - t1.x * h, y: q.y - t1.y * h), to: q)
  }

  /// Whether every one of `points` is within `tolerance` of `segment`.
  private static func fits(
    _ segment: Segment, from start: CGPoint, through points: ArraySlice<CGPoint>, within tolerance: CGFloat
  ) -> Bool {
    let steps = 8 * (points.count + 1)
    let samples = (0...steps).map { point(on: segment, from: start, at: CGFloat($0) / CGFloat(steps)) }
    return points.allSatisfy { p in
      zip(samples, samples.dropFirst()).contains { distance(p, $0, $1) <= tolerance }
    }
  }

  static func point(on s: Segment, from p: CGPoint, at t: CGFloat) -> CGPoint {
    let u = 1 - t
    let a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t
    return CGPoint(
      x: a * p.x + b * s.control1.x + c * s.control2.x + d * s.to.x,
      y: a * p.y + b * s.control1.y + c * s.control2.y + d * s.to.y)
  }

  private static func distance(_ a: CGPoint, _ b: CGPoint) -> CGFloat { max(hypot(b.x - a.x, b.y - a.y), 0.0001) }

  /// From `p` to the line `a`–`b`.
  private static func distance(_ p: CGPoint, _ a: CGPoint, _ b: CGPoint) -> CGFloat {
    let dx = b.x - a.x, dy = b.y - a.y
    let squared = dx * dx + dy * dy
    let t = squared > 0 ? max(0, min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / squared)) : 0
    return hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
  }

  // -- Measuring -----------------------------------------------------------

  /// Readings this many points either side are a point's neighbours: about
  /// 7 pt of line, shorter than a change of pressure.
  static let neighbours = 5

  /// A line read across at every point, as how far the ink reaches either
  /// side of its centre line ((0, 0): nothing read there): each point's
  /// radius. Both sides count, as PencilKit's ink needn't sit exactly on
  /// the line, which is a large share of a thin one; but where one side runs
  /// on into the stroke's other arm (about a width further, as round a small
  /// loop), the other side alone.
  ///
  /// A width far off those read nearby is a misreading (where the line
  /// crosses itself, a gap in a pencil's grain); the width nearby stands
  /// in. Measured against the readings near it, so pressing harder for a
  /// while still draws wider. Then smoothed, so the width only steps where
  /// the pressure changes. `sizes`: each point's radius from its size, for a
  /// line that couldn't be read.
  public static func read(_ sides: [(CGFloat, CGFloat)], sizes: [CGFloat]) -> [CGFloat] {
    let widths = sides.map { one, other -> CGFloat in
      let near = min(one, other)
      let far = max(one, other)
      return far > near * 1.5 && far > near + 0.4 ? 2 * near : one + other
    }
    guard widths.contains(where: { $0 > 0 }) else { return sizes.map { $0 * usualShare } }
    func median(_ values: [CGFloat]) -> CGFloat { values.sorted()[values.count / 2] }
    let overall = median(widths.filter { $0 > 0 })
    let radii = widths.indices.map { i -> CGFloat in
      let read = widths[max(i - neighbours, 0)...min(i + neighbours, widths.count - 1)].filter { $0 > 0 }
      let typical = read.isEmpty ? overall : median(read)
      return (widths[i] > typical * 0.6 && widths[i] < typical * 1.5 ? widths[i] : typical) / 2
    }
    return smoothed(smoothed(radii, by: 3), by: 3)
  }

  /// Each value the mean of those `by` either side of it.
  private static func smoothed(_ values: [CGFloat], by reach: Int) -> [CGFloat] {
    values.indices.map { i in
      let near = values[max(i - reach, 0)...min(i + reach, values.count - 1)]
      return near.reduce(0, +) / CGFloat(near.count)
    }
  }
}
