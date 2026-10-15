import PencilKit
import UIKit
import os

/// Ink as vector: each stroke's visible parts (an eraser can cut it into
/// several) as outlines whose width follows the pressure, textures aside.
/// What every other reader sees of Solstice's ink, in a drawing's SVG and a
/// PDF's stamp, so it stays sharp at any zoom: PaperKit's own rendering of
/// ink is a bitmap.
///
/// How wide and how opaque a stroke draws isn't in its points (a pen draws
/// about half its points' size, a pencil wider and grainy, depending on the
/// ink), so each stroke is drawn once by PencilKit and measured (`Look`).
enum InkOutline {
  /// One visible part of a stroke: its centre line, each point with its
  /// radius, in the markup's coordinates.
  struct Part {
    let points: [(CGPoint, CGFloat)]
    let color: UIColor
    /// How opaque it draws, all told.
    let opacity: CGFloat
    /// A marker: multiplied over what's under it, as a highlighter is.
    let multiply: Bool
  }

  /// A stroke as PencilKit draws it: its width as a share of its points'
  /// sizes, and its mean opacity (a pencil's grain, a marker's wash).
  struct Look: Sendable {
    var width: CGFloat = 1
    var opacity: CGFloat = 1
  }

  /// Ink at least this opaque is drawn as it is: overlaps can't be seen.
  private static let opaque: CGFloat = 0.95

  /// Each stroke's look, measured off the main thread (a few milliseconds
  /// a stroke), and only once for a stroke already measured.
  static func looks(of strokes: [PKStroke]) async -> [Look] {
    await Task.detached(priority: .userInitiated) { strokes.map(look) }.value
  }

  static func parts(of stroke: PKStroke, _ look: Look) -> [Part] {
    let transform = stroke.transform
    let scale = sqrt(abs(transform.a * transform.d - transform.b * transform.c))
    let color = stroke.ink.color
    return stroke.maskedPathRanges.compactMap { range in
      let points = Array(stroke.path.interpolatedPoints(in: range, by: .distance(1.5)))
      guard !points.isEmpty else { return nil }
      return Part(
        points: points.map { ($0.location.applying(transform), $0.size.width * scale / 2 * look.width) },
        color: color.withAlphaComponent(1),
        opacity: color.cgColor.alpha * look.opacity,
        multiply: stroke.ink.inkType == .marker)
    }
  }

  /// Fills `stroke`'s outline in `context`, in the markup's coordinates.
  static func draw(_ stroke: PKStroke, _ look: Look, in context: CGContext) {
    for part in parts(of: stroke, look) {
      context.saveGState()
      if part.multiply { context.setBlendMode(.multiply) }
      // Translucent ink (pencil, marker) is drawn whole, then faded: its caps
      // overlap its body, which would show through each other drawn one by
      // one. Pen ink is all but opaque, and needs no layer (each is a form
      // in the PDF).
      let layered = part.opacity < opaque
      if layered {
        context.setAlpha(part.opacity)
        context.beginTransparencyLayer(auxiliaryInfo: nil)
      }
      context.setFillColor(part.color.withAlphaComponent(layered ? 1 : part.opacity).cgColor)
      fill(part.points, in: context)
      if layered { context.endTransparencyLayer() }
      context.restoreGState()
    }
  }

  /// The outline of a line of `(centre, radius)` points: both sides, and a
  /// round cap at each end.
  private static func fill(_ points: [(CGPoint, CGFloat)], in context: CGContext) {
    let cap = { (p: CGPoint, r: CGFloat) in
      context.fillEllipse(in: CGRect(x: p.x - r, y: p.y - r, width: 2 * r, height: 2 * r))
    }
    guard points.count > 1 else { return cap(points[0].0, points[0].1) }
    let (left, right) = sides(points)
    context.beginPath()
    context.move(to: left[0])
    for p in left.dropFirst() { context.addLine(to: p) }
    for p in right.reversed() { context.addLine(to: p) }
    context.closePath()
    context.fillPath()
    cap(points[0].0, points[0].1)
    cap(points[points.count - 1].0, points[points.count - 1].1)
  }

  /// The points either side of the centre line, a radius out.
  static func sides(_ points: [(CGPoint, CGFloat)]) -> (left: [CGPoint], right: [CGPoint]) {
    var left: [CGPoint] = []
    var right: [CGPoint] = []
    for (i, (p, r)) in points.enumerated() {
      let a = points[max(i - 1, 0)].0
      let b = points[min(i + 1, points.count - 1)].0
      var dx = b.x - a.x
      var dy = b.y - a.y
      let length = max(hypot(dx, dy), 0.0001)
      dx /= length
      dy /= length
      left.append(CGPoint(x: p.x - dy * r, y: p.y + dx * r))
      right.append(CGPoint(x: p.x + dy * r, y: p.y - dx * r))
    }
    return (left, right)
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
  }

  private static let measured = OSAllocatedUnfairLock(initialState: [Key: Look]())
  /// Enough for a long notebook's ink; cleared, not trimmed, past it.
  private static let remembered = 50_000

  private static func look(_ stroke: PKStroke) -> Look {
    let key = Key(
      created: stroke.path.creationDate, count: stroke.path.count, seed: stroke.randomSeed,
      ink: stroke.ink.inkType.rawValue, width: stroke.path.first?.size.width ?? 0, color: stroke.ink.color)
    if let known = measured.withLock({ $0[key] }) { return known }
    let look = measure(stroke) ?? Look()
    measured.withLock {
      if $0.count >= remembered { $0.removeAll() }
      $0[key] = look
    }
    return look
  }

  /// Draws `stroke` alone with PencilKit and compares what it covers with
  /// the outline its points make. A pixel at least half covered counts, so
  /// antialiased edges balance out.
  private static func measure(_ stroke: PKStroke) -> Look? {
    let points = Array(stroke.path.interpolatedPoints(by: .distance(1.5)))
    guard points.count > 1 else { return nil }
    let t = stroke.transform
    let scale = sqrt(abs(t.a * t.d - t.b * t.c))
    let centre = points.map { ($0.location.applying(t), $0.size.width * scale / 2) }
    // The outline's area at width share f: f * body + f² * caps.
    var body: CGFloat = 0
    for i in 1..<centre.count {
      let (a, ra) = centre[i - 1]
      let (b, rb) = centre[i]
      body += (ra + rb) * hypot(b.x - a.x, b.y - a.y)
    }
    let caps = CGFloat.pi * (pow(centre[0].1, 2) + pow(centre[centre.count - 1].1, 2)) / 2

    // Rebuilt from its parts: PKDrawing(strokes:) throws (an Objective-C
    // exception, so a crash) on the strokes PaperKit hands out.
    let fresh = PKStroke(ink: stroke.ink, path: stroke.path, transform: stroke.transform, mask: stroke.mask)
    let bounds = fresh.renderBounds
    guard bounds.width > 0, bounds.height > 0 else { return nil }
    let typical = centre.map(\.1).sorted()[centre.count / 2] * 2
    // About 8 pixels across the line, within a couple of megapixels.
    let pixels = min(max(2, 8 / max(typical, 0.1)), 12, sqrt(2_000_000 / (bounds.width * bounds.height)))
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
    var covered = 0
    var sum = 0
    for a in alpha {
      sum += Int(a)
      if a >= 128 { covered += 1 }
    }
    guard covered > 0, body + caps > 0 else { return nil }
    let area = CGFloat(covered) / (pixels * pixels)
    let share =
      caps > 0 ? (-body + sqrt(body * body + 4 * caps * area)) / (2 * caps) : area / body
    return Look(width: share, opacity: min(1, CGFloat(sum) / CGFloat(covered) / 255))
  }
}
