import PencilKit
import UIKit
import os

/// Ink as vector, drawn as PencilKit draws it: a round nib swept along each
/// stroke's visible parts (an eraser can cut it into several), its width
/// following the pressure, textures aside. What every other reader sees of
/// Solstice's ink, in a drawing's SVG and a PDF's stamp, so it stays sharp
/// and smooth at any zoom: PaperKit's own rendering of ink is a bitmap.
///
/// How wide a stroke draws at each point isn't in its points (a pen draws
/// about half its points' size, thinner where it's pressed lightly, a pencil
/// wider and grainy), so each stroke is drawn once by PencilKit and measured
/// across at every point (`Look`).
enum InkOutline {
  /// One visible part of a stroke, as runs of curve each stroked at one
  /// width (the width steps where the pressure changes), in the markup's
  /// coordinates.
  struct Part {
    let runs: [(path: CGPath, width: CGFloat)]
    let color: UIColor
    /// How opaque it draws, all told.
    let opacity: CGFloat
    /// A marker: multiplied over what's under it, as a highlighter is.
    let multiply: Bool
  }

  /// A stroke as PencilKit draws it: each part's radius at each of its
  /// points (`step` apart), and its mean opacity (a pencil's grain, a
  /// marker's wash). Empty radii: drawn from the points' sizes.
  struct Look: Sendable {
    var radii: [[Float]] = []
    var opacity: CGFloat = 1
  }

  /// Between the points the nib is swept through.
  private static let step: CGFloat = 1.5
  /// A pen draws about this share of its points' size, for a stroke that
  /// couldn't be measured.
  private static let usualShare: CGFloat = 0.55
  /// A run's width stays within this share of where it started.
  private static let widthStep: CGFloat = 0.04
  /// Ink at least this opaque is drawn as it is: overlaps can't be seen.
  private static let opaque: CGFloat = 0.95

  /// Each stroke's look, measured off the main thread (a few milliseconds
  /// a stroke), and only once for a stroke already measured.
  static func looks(of strokes: [PKStroke]) async -> [Look] {
    await Task.detached(priority: .userInitiated) { strokes.map(look) }.value
  }

  static func parts(of stroke: PKStroke, _ look: Look) -> [Part] {
    let color = stroke.ink.color
    return centres(of: stroke).enumerated().compactMap { index, points in
      guard !points.isEmpty else { return nil }
      let measured = look.radii[safe: index].flatMap { $0.count == points.count ? $0 : nil }
      let line = points.enumerated().map { i, p in (p.0, measured.map { CGFloat($0[i]) } ?? p.1 * usualShare) }
      return Part(
        runs: runs(line), color: color.withAlphaComponent(1),
        opacity: color.cgColor.alpha * look.opacity, multiply: stroke.ink.inkType == .marker)
    }
  }

  /// Strokes `stroke` in `context`, in the markup's coordinates.
  static func draw(_ stroke: PKStroke, _ look: Look, in context: CGContext) {
    for part in parts(of: stroke, look) {
      context.saveGState()
      if part.multiply { context.setBlendMode(.multiply) }
      // Translucent ink (pencil, marker) is drawn whole, then faded: its
      // runs overlap where they meet. Pen ink is all but opaque, and needs
      // no layer (each is a form in the PDF).
      let layered = part.opacity < opaque
      if layered {
        context.setAlpha(part.opacity)
        context.beginTransparencyLayer(auxiliaryInfo: nil)
      }
      context.setStrokeColor(part.color.withAlphaComponent(layered ? 1 : part.opacity).cgColor)
      context.setLineCap(.round)
      context.setLineJoin(.round)
      for run in part.runs {
        context.setLineWidth(run.width)
        context.addPath(run.path)
        context.strokePath()
      }
      if layered { context.endTransparencyLayer() }
      context.restoreGState()
    }
  }

  // -- Geometry ------------------------------------------------------------

  /// Each visible part's centre line, each point with the radius its size
  /// gives (before measuring).
  private static func centres(of stroke: PKStroke) -> [[(CGPoint, CGFloat)]] {
    let transform = stroke.transform
    let scale = sqrt(abs(transform.a * transform.d - transform.b * transform.c))
    return stroke.maskedPathRanges.map { range in
      stroke.path.interpolatedPoints(in: range, by: .distance(step)).map {
        ($0.location.applying(transform), $0.size.width * scale / 2)
      }
    }
  }

  /// The line cut into runs whose width stays within `widthStep`, each a
  /// smooth curve through its points; consecutive runs share a point, and
  /// their round caps meet there.
  private static func runs(_ line: [(CGPoint, CGFloat)]) -> [(path: CGPath, width: CGFloat)] {
    guard line.count > 1 else {
      // A dot: a round cap on a line of no length.
      let (p, r) = line[0]
      let dot = CGMutablePath()
      dot.move(to: p)
      dot.addLine(to: p)
      return [(dot, 2 * r)]
    }
    var out: [(path: CGPath, width: CGFloat)] = []
    var start = 0
    while start < line.count - 1 {
      var end = start + 1
      let r = line[start].1
      while end < line.count - 1, abs(line[end + 1].1 - r) <= max(r * widthStep, 0.01) { end += 1 }
      let run = line[start...end]
      let mean = run.map(\.1).reduce(0, +) / CGFloat(run.count)
      out.append((curve(through: run.map(\.0)), 2 * mean))
      start = end
    }
    return out
  }

  /// A smooth curve through every point: each point's tangent from its
  /// neighbours, scaled by the distance to the next, so it neither kinks
  /// nor overshoots where points bunch up.
  static func curve(through points: [CGPoint]) -> CGPath {
    let path = CGMutablePath()
    path.move(to: points[0])
    func distance(_ a: CGPoint, _ b: CGPoint) -> CGFloat { max(hypot(b.x - a.x, b.y - a.y), 0.0001) }
    func tangent(_ i: Int) -> CGPoint {
      let a = points[max(i - 1, 0)]
      let b = points[min(i + 1, points.count - 1)]
      let length = distance(a, points[i]) + distance(points[i], b)
      return CGPoint(x: (b.x - a.x) / length, y: (b.y - a.y) / length)
    }
    for i in 0..<(points.count - 1) {
      let p = points[i]
      let q = points[i + 1]
      let h = distance(p, q) / 3
      let t0 = tangent(i)
      let t1 = tangent(i + 1)
      path.addCurve(
        to: q, control1: CGPoint(x: p.x + t0.x * h, y: p.y + t0.y * h),
        control2: CGPoint(x: q.x - t1.x * h, y: q.y - t1.y * h))
    }
    return path
  }

  // -- Measuring -----------------------------------------------------------

  /// A stroke, as far as its look goes.
  private struct Key: Hashable {
    let created: Date
    let count: Int
    let seed: UInt32
    let ink: String
    let width: CGFloat
    let color: UIColor
    let transform: [CGFloat]
    let parts: Int
  }

  private static let measured = OSAllocatedUnfairLock(initialState: (looks: [Key: Look](), points: 0))
  /// Radii kept (4 bytes each): a long notebook's worth. Past it, the cache
  /// starts again.
  private static let remembered = 4_000_000

  private static func look(_ stroke: PKStroke) -> Look {
    let t = stroke.transform
    let key = Key(
      created: stroke.path.creationDate, count: stroke.path.count, seed: stroke.randomSeed,
      ink: stroke.ink.inkType.rawValue, width: stroke.path.first?.size.width ?? 0, color: stroke.ink.color,
      transform: [t.a, t.b, t.c, t.d, t.tx, t.ty], parts: stroke.maskedPathRanges.count)
    if let known = measured.withLock({ $0.looks[key] }) { return known }
    let look = measure(stroke) ?? Look()
    let size = look.radii.reduce(0) { $0 + $1.count }
    measured.withLock {
      if $0.points + size > remembered { $0 = ([:], 0) }
      $0.looks[key] = look
      $0.points += size
    }
    return look
  }

  /// Draws `stroke` alone with PencilKit and reads, at each point, how far
  /// the ink reaches either side of the centre line. A pixel at least half
  /// covered counts, so antialiased edges balance out.
  private static func measure(_ stroke: PKStroke) -> Look? {
    // Rebuilt from its parts: PKDrawing(strokes:) throws (an Objective-C
    // exception, so a crash) on the strokes PaperKit hands out.
    let fresh = PKStroke(ink: stroke.ink, path: stroke.path, transform: stroke.transform, mask: stroke.mask)
    let bounds = fresh.renderBounds
    let lines = centres(of: stroke)
    let sizes = lines.flatMap { $0.map(\.1) }.sorted()
    guard bounds.width > 0, bounds.height > 0, !sizes.isEmpty else { return nil }
    // About 10 pixels across the line, within a couple of megapixels.
    let typical = sizes[sizes.count / 2] * 2 * usualShare
    let pixels = min(max(2, 10 / max(typical, 0.1)), 16, sqrt(2_000_000 / (bounds.width * bounds.height)))
    guard let image = PKDrawing(strokes: [fresh]).image(from: bounds, scale: pixels).cgImage else { return nil }
    let width = image.width
    let height = image.height
    var alpha = [UInt8](repeating: 0, count: width * height)
    let drawn = alpha.withUnsafeMutableBytes { buffer -> Bool in
      guard
        let context = CGContext(
          data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width,
          space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.alphaOnly.rawValue)
      else { return false }
      context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
      return true
    }
    guard drawn else { return nil }

    func inked(_ p: CGPoint) -> Bool {
      let column = Int((p.x - bounds.minX) * pixels)
      let row = Int((p.y - bounds.minY) * pixels)
      return column >= 0 && row >= 0 && column < width && row < height && alpha[row * width + column] >= 128
    }
    var radii: [[Float]] = []
    for line in lines {
      var found: [CGFloat] = []
      for (i, (p, size)) in line.enumerated() {
        let a = line[max(i - 1, 0)].0
        let b = line[min(i + 1, line.count - 1)].0
        let length = hypot(b.x - a.x, b.y - a.y)
        // Across the line; a dot has no direction, so every way round.
        let across =
          length > 0.001
          ? [CGPoint(x: -(b.y - a.y) / length, y: (b.x - a.x) / length)]
          : [CGPoint(x: 1, y: 0), CGPoint(x: 0, y: 1), CGPoint(x: 0.7071, y: 0.7071), CGPoint(x: 0.7071, y: -0.7071)]
        let limit = size * 3 + 2
        func reach(_ direction: CGPoint) -> CGFloat {
          var d: CGFloat = 0
          while d < limit, inked(CGPoint(x: p.x + direction.x * d, y: p.y + direction.y * d)) {
            d += 0.5 / pixels
          }
          return d
        }
        // The nearer side: across a corner the far side runs into the
        // stroke's other arm. Ink to the limit is a misreading.
        let nearest = across.flatMap { [reach($0), reach(CGPoint(x: -$0.x, y: -$0.y))] }.min() ?? 0
        found.append(inked(p) && nearest < limit ? nearest : 0)
      }
      radii.append(cleaned(found, sizes: line.map(\.1)).map(Float.init))
    }

    var covered = 0
    var sum = 0
    for a in alpha {
      sum += Int(a)
      if a >= 128 { covered += 1 }
    }
    let opacity = covered > 0 ? min(1, CGFloat(sum) / CGFloat(covered) / 255) : 1
    return Look(radii: radii, opacity: opacity)
  }

  /// Misreadings out (a loop crossing itself reads too wide, a gap in a
  /// pencil's grain too narrow), then a little smoothing.
  private static func cleaned(_ radii: [CGFloat], sizes: [CGFloat]) -> [CGFloat] {
    let good = radii.filter { $0 > 0 }.sorted()
    let median = good.isEmpty ? 0 : good[good.count / 2]
    let fixed = radii.enumerated().map { i, r -> CGFloat in
      if median == 0 { return sizes[i] * usualShare }
      return r > 0 && r < median * 1.8 ? r : median
    }
    return fixed.indices.map { i in
      (fixed[max(i - 1, 0)] + fixed[i] + fixed[min(i + 1, fixed.count - 1)]) / 3
    }
  }
}
