import PencilKit
import SurfaceCore
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
  private static let usualShare = InkLine.usualShare
  /// Ink at least this opaque is drawn as it is: overlaps can't be seen.
  private static let opaque: CGFloat = 0.95

  /// Each stroke's look, measured off the main thread (a few milliseconds
  /// a stroke), and only once for a stroke already measured. Below the
  /// canvas's own drawing in priority: a save can wait, the ink on screen can't.
  static func looks(of strokes: [PKStroke]) async -> [Look] {
    await Task.detached(priority: .utility) { strokes.map(look) }.value
  }

  static func parts(of stroke: PKStroke, _ look: Look) -> [Part] {
    let color = stroke.ink.color
    return centres(of: stroke).enumerated().compactMap { index, points in
      guard !points.isEmpty else { return nil }
      let measured = look.radii[safe: index].flatMap { $0.count == points.count ? $0 : nil }
      let line = points.enumerated().map { i, p in
        (point: p.0, radius: measured.map { CGFloat($0[i]) } ?? p.1 * usualShare)
      }
      return Part(
        runs: InkLine.runs(line).map { (path(of: $0), $0.width) }, color: color.withAlphaComponent(1),
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

  /// Across the line at point `i`, from its neighbours; zero at a dot.
  private static func normal(_ points: [CGPoint], _ i: Int) -> CGPoint {
    let a = points[max(i - 1, 0)]
    let b = points[min(i + 1, points.count - 1)]
    let length = hypot(b.x - a.x, b.y - a.y)
    return length > 0.001 ? CGPoint(x: -(b.y - a.y) / length, y: (b.x - a.x) / length) : .zero
  }

  /// A run as a path; a dot is a round cap on a line of no length.
  private static func path(of run: InkLine.Run) -> CGPath {
    let path = CGMutablePath()
    path.move(to: run.start)
    if run.segments.isEmpty { path.addLine(to: run.start) }
    for segment in run.segments {
      path.addCurve(to: segment.to, control1: segment.control1, control2: segment.control2)
    }
    return path
  }

  // -- Measuring -----------------------------------------------------------

  /// A stroke, as far as its look goes. Not where it is: moving a stroke
  /// (the lasso, the canvas growing) doesn't change how it's drawn.
  struct Key: Hashable, Sendable {
    let created: Date
    let count: Int
    let seed: UInt32
    let ink: String
    let width: CGFloat
    let color: UIColor
    /// The transform's scale and rotation.
    let transform: [CGFloat]
    /// What an eraser left of it, as ranges of its path.
    let parts: [CGFloat]
  }

  static func key(of stroke: PKStroke) -> Key {
    let t = stroke.transform
    return Key(
      created: stroke.path.creationDate, count: stroke.path.count, seed: stroke.randomSeed,
      ink: stroke.ink.inkType.rawValue, width: stroke.path.first?.size.width ?? 0, color: stroke.ink.color,
      transform: [t.a, t.b, t.c, t.d],
      parts: stroke.maskedPathRanges.flatMap { [$0.lowerBound, $0.upperBound] })
  }

  private static let measured = OSAllocatedUnfairLock(initialState: (looks: [Key: Look](), points: 0))
  /// Radii kept (4 bytes each): a long notebook's worth. Past it, the cache
  /// starts again.
  private static let remembered = 4_000_000

  private static func look(_ stroke: PKStroke) -> Look {
    let key = key(of: stroke)
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
  /// the ink reaches either side of the centre line (`InkLine.read`): to
  /// where it's half covered, read between pixels, so a thin line isn't a
  /// pixel short.
  private static func measure(_ stroke: PKStroke) -> Look? {
    // Rebuilt from its parts: PKDrawing(strokes:) throws (an Objective-C
    // exception, so a crash) on the strokes PaperKit hands out.
    let fresh = PKStroke(ink: stroke.ink, path: stroke.path, transform: stroke.transform, mask: stroke.mask)
    // In whole points: from a fractional origin, PencilKit's picture sits a
    // little off where it's read.
    let bounds = fresh.renderBounds.insetBy(dx: -1, dy: -1).integral
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

    // The picture's own size: `pixels` times the bounds, rounded.
    let across = CGFloat(width) / bounds.width
    let down = CGFloat(height) / bounds.height
    /// How covered `p` is, 0 to 255, from the four pixels around it.
    func cover(_ p: CGPoint) -> CGFloat {
      let x = (p.x - bounds.minX) * across - 0.5
      let y = (p.y - bounds.minY) * down - 0.5
      let column = Int(x.rounded(.down))
      let row = Int(y.rounded(.down))
      let fx = x - CGFloat(column)
      let fy = y - CGFloat(row)
      func at(_ c: Int, _ r: Int) -> CGFloat {
        c >= 0 && r >= 0 && c < width && r < height ? CGFloat(alpha[r * width + c]) : 0
      }
      let top = at(column, row) * (1 - fx) + at(column + 1, row) * fx
      let bottom = at(column, row + 1) * (1 - fx) + at(column + 1, row + 1) * fx
      return top * (1 - fy) + bottom * fy
    }
    func inked(_ p: CGPoint) -> Bool { cover(p) >= 128 }
    var radii: [[Float]] = []
    for line in lines {
      let centre = line.map(\.0)
      let sides = line.indices.map { i -> (CGFloat, CGFloat) in
        let (p, size) = line[i]
        let limit = size * 3 + 2
        func reach(_ direction: CGPoint) -> CGFloat {
          let step = 0.25 / pixels
          var d: CGFloat = 0
          var last = cover(p)
          while d < limit {
            let next = cover(CGPoint(x: p.x + direction.x * (d + step), y: p.y + direction.y * (d + step)))
            // Half covered somewhere in this step: where, along it.
            if next < 128 { return d + step * (last - 128) / max(last - next, 1) }
            last = next
            d += step
          }
          return limit
        }
        guard inked(p) else { return (0, 0) }
        let side = normal(centre, i)
        let read: (CGFloat, CGFloat)
        if side == .zero {
          // A dot has no direction: its narrowest way round, centred.
          let ways = [CGPoint(x: 1, y: 0), CGPoint(x: 0, y: 1), CGPoint(x: 0.7071, y: 0.7071), CGPoint(x: 0.7071, y: -0.7071)]
          let half = ways.map { (reach($0) + reach(CGPoint(x: -$0.x, y: -$0.y))) / 2 }.min() ?? 0
          read = (half, half)
        } else {
          read = (reach(side), reach(CGPoint(x: -side.x, y: -side.y)))
        }
        // Ink to the limit is a misreading.
        return read.0 < limit && read.1 < limit ? read : (0, 0)
      }
      radii.append(InkLine.read(sides, sizes: line.map(\.1)).map(Float.init))
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
}
