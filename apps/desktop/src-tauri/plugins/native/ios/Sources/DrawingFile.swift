import PaperKit
import PencilKit
import UIKit

/// A drawing (`*.drawing.svg`): an SVG every app can show, holding a copy of
/// the drawing and the PaperKit markup it came from.
///
/// - Ink is vector: each stroke as its outline, its width following the
///   pressure (textures aside). Shapes, text, stickers and images are one
///   picture beneath it, rendered by PaperKit.
/// - `<metadata><solstice:paper>` holds the markup, base64, to edit again;
///   `<desc>` the handwriting PaperKit recognised, for search.
/// - The viewBox is the content's bounds, in the markup's points, on white
///   paper as it was drawn.
enum DrawingFile {
  static let namespace = "https://sunstead.app/solstice"
  /// Room around the content in the copy.
  private static let margin: CGFloat = 24
  /// The picture layer's pixels per point, at most.
  private static let pictureScale: CGFloat = 3
  /// The picture layer's pixels, at most: past this it's drawn coarser.
  static let pictureBudget = 16_000_000

  /// The markup in an existing file, or nil for a new one.
  static func read(_ svg: String) -> PaperMarkup? {
    guard let open = svg.range(of: "<solstice:paper"),
      let start = svg.range(of: ">", range: open.upperBound..<svg.endIndex),
      let end = svg.range(of: "</solstice:paper>", range: start.upperBound..<svg.endIndex),
      let data = Data(base64Encoded: String(svg[start.upperBound..<end.lowerBound]))
    else { return nil }
    return try? PaperMarkup(dataRepresentation: data)
  }

  /// Writes a drawing's file, one save after another. Each save of a
  /// growing drawing did all of it again: every stroke's outline, and the
  /// picture layer over all of it. This keeps what it made of each stroke;
  /// the picture is drawn again each time (PaperKit's markups can't be told
  /// apart), but only over what's in it.
  actor Writer {
    /// A stroke where it is: its look (`InkOutline.Key`) and its place.
    private struct Placed: Hashable {
      let look: InkOutline.Key
      let x: CGFloat
      let y: CGFloat
    }

    /// Each stroke's SVG, for the strokes the last save had.
    private var strokes: [Placed: String] = [:]
    /// How many strokes' SVG it has made.
    private(set) var built = 0

    /// The SVG of `markup`, with `text` as the handwriting recognised in it.
    func write(_ markup: PaperMarkup, text: String) async throws -> String {
      let data = try await markup.dataRepresentation()
      let content = markup.contentsRenderFrame
      let box =
        content.isNull || content.isEmpty
        ? CGRect(x: markup.bounds.midX - 512, y: markup.bounds.midY - 384, width: 1024, height: 768)
        : content.insetBy(dx: -margin, dy: -margin)

      // Paper, as it's drawn on: dark ink stays readable on a dark page.
      var body = "  <rect x=\"\(n(box.minX))\" y=\"\(n(box.minY))\" width=\"\(n(box.width))\" height=\"\(n(box.height))\" fill=\"#fff\"/>\n"
      if let rest = markup.withoutInk { body += await DrawingFile.picture(of: rest) ?? "" }
      body += await ink(of: Array(markup.subelements.strokes))

      return """
        <svg xmlns="http://www.w3.org/2000/svg" xmlns:solstice="\(namespace)" \
        viewBox="\(n(box.minX)) \(n(box.minY)) \(n(box.width)) \(n(box.height))" \
        width="\(n(box.width))" height="\(n(box.height))">
          <metadata><solstice:paper version="1">\(data.base64EncodedString())</solstice:paper></metadata>
          <desc>\(escape(text))</desc>
        \(body)</svg>

        """
    }

    /// The strokes' SVG, made afresh only for strokes the last save didn't have.
    private func ink(of strokes: [PKStroke]) async -> String {
      let placed = strokes.map { stroke in
        Placed(look: InkOutline.key(of: stroke), x: stroke.transform.tx, y: stroke.transform.ty)
      }
      let missing = placed.indices.filter { self.strokes[placed[$0]] == nil }
      let looks = await InkOutline.looks(of: missing.map { strokes[$0] })
      var kept: [Placed: String] = [:]
      for (i, look) in zip(missing, looks) {
        kept[placed[i]] = DrawingFile.stroke(strokes[i], look)
        built += 1
      }
      for key in placed where kept[key] == nil {
        kept[key] = self.strokes[key]
      }
      self.strokes = kept
      return placed.compactMap { kept[$0] }.joined()
    }
  }

  // -- Ink ------------------------------------------------------------

  /// A stroke's visible parts as `InkOutline` sweeps them: runs of curve,
  /// each stroked at its width, faded together.
  static func stroke(_ stroke: PKStroke, _ look: InkOutline.Look) -> String {
    var out = ""
    for part in InkOutline.parts(of: stroke, look) {
      let (color, _) = hex(part.color)
      let opacity = part.opacity < 0.995 ? " opacity=\"\(n(part.opacity))\"" : ""
      let blend = part.multiply ? " style=\"mix-blend-mode:multiply\"" : ""
      out += "  <g fill=\"none\" stroke=\"\(color)\" stroke-linecap=\"round\" stroke-linejoin=\"round\"\(opacity)\(blend)>\n"
      for run in part.runs {
        out += "    <path d=\"\(svg(run.path))\" stroke-width=\"\(n(run.width))\"/>\n"
      }
      out += "  </g>\n"
    }
    return out
  }

  /// A path as SVG path data.
  private static func svg(_ path: CGPath) -> String {
    var d = ""
    path.applyWithBlock { element in
      let e = element.pointee
      let p = { (i: Int) in "\(n(e.points[i].x)) \(n(e.points[i].y))" }
      switch e.type {
      case .moveToPoint: d += "M\(p(0))"
      case .addLineToPoint: d += "L\(p(0))"
      case .addQuadCurveToPoint: d += "Q\(p(0)) \(p(1))"
      case .addCurveToPoint: d += "C\(p(0)) \(p(1)) \(p(2))"
      case .closeSubpath: d += "Z"
      @unknown default: break
      }
    }
    return d
  }

  // -- Everything else ---------------------------------------------------

  /// `rest` (shapes, text, stickers and images, no ink) as PaperKit draws
  /// them, an `<image>` over what they cover; nil if there are none. Within
  /// `pictureBudget` pixels: drawn over all the content, a text box far from
  /// the ink made a picture of gigabytes.
  private static func picture(of rest: PaperMarkup) async -> String? {
    let frame = rest.contentsRenderFrame
    guard !frame.isNull, !frame.isEmpty else { return nil }
    let box = frame.insetBy(dx: -2, dy: -2)

    let size = box.size
    let scale = min(pictureScale, (CGFloat(pictureBudget) / (size.width * size.height)).squareRoot())
    // A bitmap of our own: drawing the markup is async, which
    // UIGraphicsImageRenderer's block can't be.
    let width = Int(size.width * scale)
    let height = Int(size.height * scale)
    guard width > 0, height > 0,
      let bitmap = CGContext(
        data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpace(name: CGColorSpace.sRGB)!,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { return nil }
    // Top-left origin, as the markup is laid out, with `box` on the image.
    // PaperKit draws in the markup's own coordinates whatever `frame` says.
    bitmap.translateBy(x: 0, y: CGFloat(height))
    bitmap.scaleBy(x: CGFloat(width) / size.width, y: -CGFloat(height) / size.height)
    bitmap.translateBy(x: -box.minX, y: -box.minY)
    await rest.draw(in: bitmap, frame: box, options: RenderingOptions(darkUserInterfaceStyle: false))
    guard let made = bitmap.makeImage(), let png = UIImage(cgImage: made).pngData() else { return nil }
    return "  <image x=\"\(n(box.minX))\" y=\"\(n(box.minY))\" width=\"\(n(box.width))\" height=\"\(n(box.height))\" href=\"data:image/png;base64,\(png.base64EncodedString())\"/>\n"
  }

  // -- Text ------------------------------------------------------------

  static func n(_ value: CGFloat) -> String {
    let rounded = (value * 100).rounded() / 100
    return rounded == rounded.rounded() ? String(Int(rounded)) : String(format: "%.2f", rounded)
  }

  private static func hex(_ color: UIColor) -> (String, CGFloat) {
    var r: CGFloat = 0
    var g: CGFloat = 0
    var b: CGFloat = 0
    var a: CGFloat = 0
    let srgb =
      CGColorSpace(name: CGColorSpace.sRGB).flatMap {
        color.cgColor.converted(to: $0, intent: .defaultIntent, options: nil)
      }.map { UIColor(cgColor: $0) } ?? color
    srgb.getRed(&r, green: &g, blue: &b, alpha: &a)
    let byte = { (v: CGFloat) in Int((min(max(v, 0), 1) * 255).rounded()) }
    return (String(format: "#%02x%02x%02x", byte(r), byte(g), byte(b)), a)
  }

  static func escape(_ text: String) -> String {
    text.replacingOccurrences(of: "&", with: "&amp;")
      .replacingOccurrences(of: "<", with: "&lt;")
      .replacingOccurrences(of: ">", with: "&gt;")
  }
}

extension PaperMarkup {
  /// Everything but the ink (shapes, text, images, loupes, links), drawn by
  /// PaperKit as a picture; nil if there's nothing else. A new markup with
  /// just those: removing the strokes one at a time took seconds in a big
  /// drawing, on every save (and `removeAll(where:)` leaves some behind).
  var withoutInk: PaperMarkup? {
    let other = subelements.filter {
      if case .stroke = $0.elementID { return false }
      return true
    }
    guard !other.isEmpty else { return nil }
    var rest = PaperMarkup(bounds: bounds)
    rest.backgroundColor = backgroundColor
    rest.subelements.append(contentsOf: other)
    return rest
  }
}
