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
  /// The picture layer's pixels per point.
  private static let pictureScale: CGFloat = 3

  /// The markup in an existing file, or nil for a new one.
  static func read(_ svg: String) -> PaperMarkup? {
    guard let open = svg.range(of: "<solstice:paper"),
      let start = svg.range(of: ">", range: open.upperBound..<svg.endIndex),
      let end = svg.range(of: "</solstice:paper>", range: start.upperBound..<svg.endIndex),
      let data = Data(base64Encoded: String(svg[start.upperBound..<end.lowerBound]))
    else { return nil }
    return try? PaperMarkup(dataRepresentation: data)
  }

  static func write(_ markup: PaperMarkup) async throws -> String {
    let data = try await markup.dataRepresentation()
    let text = await markup.indexableContent
    let content = markup.contentsRenderFrame
    let box =
      content.isNull || content.isEmpty
      ? CGRect(x: markup.bounds.midX - 512, y: markup.bounds.midY - 384, width: 1024, height: 768)
      : content.insetBy(dx: -margin, dy: -margin)

    // Paper, as it's drawn on: dark ink stays readable on a dark page.
    var body = "  <rect x=\"\(n(box.minX))\" y=\"\(n(box.minY))\" width=\"\(n(box.width))\" height=\"\(n(box.height))\" fill=\"#fff\"/>\n"
    if let picture = await picture(of: markup, in: box) {
      body += "  <image x=\"\(n(box.minX))\" y=\"\(n(box.minY))\" width=\"\(n(box.width))\" height=\"\(n(box.height))\" href=\"data:image/png;base64,\(picture.base64EncodedString())\"/>\n"
    }
    let strokes = Array(markup.subelements.strokes)
    for (stroke, look) in zip(strokes, await InkOutline.looks(of: strokes)) {
      body += self.stroke(stroke, look)
    }

    return """
      <svg xmlns="http://www.w3.org/2000/svg" xmlns:solstice="\(namespace)" \
      viewBox="\(n(box.minX)) \(n(box.minY)) \(n(box.width)) \(n(box.height))" \
      width="\(n(box.width))" height="\(n(box.height))">
        <metadata><solstice:paper version="1">\(data.base64EncodedString())</solstice:paper></metadata>
        <desc>\(escape(text ?? ""))</desc>
      \(body)</svg>

      """
  }

  // -- Ink ------------------------------------------------------------

  /// A stroke's visible parts as `InkOutline` sweeps them: runs of curve,
  /// each stroked at its width, faded together.
  private static func stroke(_ stroke: PKStroke, _ look: InkOutline.Look) -> String {
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

  /// Shapes, text, stickers and images, as PaperKit draws them; nil if the
  /// drawing is only ink.
  private static func picture(of markup: PaperMarkup, in box: CGRect) async -> Data? {
    var rest = markup
    for id in markup.subelements.ids {
      if case .stroke = id { _ = rest.subelements.removeElement(for: id) }
    }
    guard !rest.subelements.ids.isEmpty else { return nil }

    let size = box.size
    // A bitmap of our own: drawing the markup is async, which
    // UIGraphicsImageRenderer's block can't be.
    let width = Int(size.width * pictureScale)
    let height = Int(size.height * pictureScale)
    guard width > 0, height > 0,
      let bitmap = CGContext(
        data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpace(name: CGColorSpace.sRGB)!,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { return nil }
    // Top-left origin, as the markup is laid out, with `box` on the image.
    // PaperKit draws in the markup's own coordinates whatever `frame` says.
    bitmap.translateBy(x: 0, y: CGFloat(height))
    bitmap.scaleBy(x: pictureScale, y: -pictureScale)
    bitmap.translateBy(x: -box.minX, y: -box.minY)
    await rest.draw(in: bitmap, frame: box, options: RenderingOptions(darkUserInterfaceStyle: false))
    guard let made = bitmap.makeImage() else { return nil }
    return UIImage(cgImage: made).pngData()
  }

  // -- Text ------------------------------------------------------------

  private static func n(_ value: CGFloat) -> String {
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

  private static func escape(_ text: String) -> String {
    text.replacingOccurrences(of: "&", with: "&amp;")
      .replacingOccurrences(of: "<", with: "&lt;")
      .replacingOccurrences(of: ">", with: "&gt;")
  }
}
