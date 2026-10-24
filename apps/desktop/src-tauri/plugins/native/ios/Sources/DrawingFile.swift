import Foundation
import PaperKit
import PencilKit
import UIKit

/// A drawing (`*.drawing.svg`): an SVG every app can show, holding a copy of
/// the drawing and the PaperKit markup it came from.
///
/// - `<desc>` comes first, the handwriting PaperKit recognised, for search:
///   a reader needn't get through the rest to find it.
/// - `<metadata><solstice:paper>` holds the markup to edit again: deflated
///   then base64 (`version="2"`; version 1 wasn't deflated).
/// - Ink is vector: each stroke as its outline, its width following the
///   pressure (textures aside), in a `<g data-s>` named for how it looks
///   (`InkOutline.digest`) and drawn in its own space, moved into place. A
///   save keeps what earlier ones made, even across opening the file again.
///   Shapes, text, stickers and images are one picture beneath it, rendered
///   by PaperKit.
/// - The viewBox is the content's bounds, in the markup's points, on white
///   paper as it was drawn.
enum DrawingFile {
  static let namespace = "https://sunstead.app/solstice"
  /// The format written. A file of a later one isn't edited here (a save
  /// would lose what this doesn't know).
  static let version = 2
  /// Room around the content in the copy.
  private static let margin: CGFloat = 24
  /// The picture layer's pixels per point, at most.
  private static let pictureScale: CGFloat = 3
  /// The picture layer's pixels, at most: past this it's drawn coarser.
  static let pictureBudget = 16_000_000

  /// What a drawing's file holds.
  struct Contents: @unchecked Sendable {
    /// Nil for a new drawing.
    var markup: PaperMarkup?
    /// The handwriting as last recognised (`<desc>`).
    var text: String?
    /// Each stroke's SVG, by its name (`data-s`).
    var strokes: [String: String] = [:]
    /// The copy's viewBox: what's drawn, give or take the margin.
    var drawn: CGRect?
    /// How many elements the markup has: how long recognising it will take.
    var elements = 0
  }

  enum ReadError: LocalizedError {
    case newer(Int)
    case unreadable

    var errorDescription: String? {
      switch self {
      case .newer: "This drawing was saved by a newer Solstice. Update Solstice to edit it."
      case .unreadable: "This drawing's markup couldn't be read, so it can't be edited here."
      }
    }
  }

  /// The file at `url`, read without holding the whole of it as text. A file
  /// that isn't there is a new drawing.
  static func read(contentsOf url: URL) throws -> Contents {
    guard FileManager.default.fileExists(atPath: url.path) else { return Contents() }
    return try read(try Data(contentsOf: url, options: .alwaysMapped))
  }

  static func read(_ data: Data) throws -> Contents {
    var contents = Contents()
    contents.text = text(between: "<desc>", and: "</desc>", in: data).map(unescape)
    contents.drawn = viewBox(in: data)
    guard let open = data.range(of: Data("<solstice:paper".utf8)) else { return contents }
    guard let tagEnd = data.range(of: Data(">".utf8), in: open.upperBound..<data.endIndex),
      let close = data.range(of: Data("</solstice:paper>".utf8), in: tagEnd.upperBound..<data.endIndex)
    else { throw ReadError.unreadable }
    let tag = String(decoding: data[open.upperBound..<tagEnd.lowerBound], as: UTF8.self)
    let version = attribute("version", in: tag).flatMap(Int.init) ?? 1
    guard version <= Self.version else { throw ReadError.newer(version) }
    guard var markupData = Data(base64Encoded: data[tagEnd.upperBound..<close.lowerBound], options: .ignoreUnknownCharacters)
    else { throw ReadError.unreadable }
    if attribute("encoding", in: tag) == "deflate" {
      guard let inflated = try? (markupData as NSData).decompressed(using: .zlib) as Data else { throw ReadError.unreadable }
      markupData = inflated
    }
    guard let markup = try? PaperMarkup(dataRepresentation: markupData) else { throw ReadError.unreadable }
    contents.markup = markup
    contents.elements = markup.subelements.count
    contents.strokes = strokes(in: data[close.upperBound...])
    return contents
  }

  /// Writes a drawing's file, one save after another. Each save of a
  /// growing drawing did all of it again: every stroke's outline, and the
  /// picture layer over all of it. This keeps what it made of each stroke,
  /// seeded from the file when it's opened (measuring every stroke again
  /// took minutes in a big drawing), and the picture while only ink changes.
  actor Writer {
    /// Each stroke's SVG, for the strokes the last save had, by how it looks.
    private var strokes: [InkOutline.Key: (name: String, svg: String)] = [:]
    /// What the file had, by name, until the first save has used it.
    private var seeded: [String: String] = [:]
    /// The picture layer, and what it's a picture of.
    private var picture: (of: String, svg: String)?
    /// How many strokes' SVG it has made, and pictures it has drawn.
    private(set) var built = 0
    private(set) var pictures = 0

    /// The strokes' SVG a file already holds (`Contents.strokes`).
    func seed(_ strokes: [String: String]) {
      seeded = strokes
    }

    /// The SVG of `markup`, with `text` as the handwriting recognised in it.
    func write(_ markup: PaperMarkup, text: String) async throws -> String {
      let data = try await markup.dataRepresentation()
      let packed = try (data as NSData).compressed(using: .zlib) as Data
      let all = Array(markup.subelements.strokes)
      let rest = markup.withoutInk

      // What's drawn: the strokes', and the rest's (the whole markup's
      // contentsRenderFrame took seconds in a big drawing).
      var content = all.reduce(CGRect.null) { $0.union($1.renderBounds) }
      if let rest { content = content.union(rest.contentsRenderFrame) }
      let box =
        content.isNull || content.isEmpty
        ? CGRect(x: markup.bounds.midX - 512, y: markup.bounds.midY - 384, width: 1024, height: 768)
        : content.insetBy(dx: -margin, dy: -margin)

      // Paper, as it's drawn on: dark ink stays readable on a dark page.
      var body = "  <rect x=\"\(n(box.minX))\" y=\"\(n(box.minY))\" width=\"\(n(box.width))\" height=\"\(n(box.height))\" fill=\"#fff\"/>\n"
      if let rest { body += await picture(of: rest) }
      body += "  <g fill=\"none\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n"
      body += await ink(of: all)
      body += "  </g>\n"

      return """
        <svg xmlns="http://www.w3.org/2000/svg" xmlns:solstice="\(namespace)" \
        viewBox="\(n(box.minX)) \(n(box.minY)) \(n(box.width)) \(n(box.height))" \
        width="\(n(box.width))" height="\(n(box.height))">
          <desc>\(escape(text))</desc>
          <metadata><solstice:paper version="\(version)" encoding="deflate">\(packed.base64EncodedString())</solstice:paper></metadata>
        \(body)</svg>

        """
    }

    private func picture(of rest: PaperMarkup) async -> String {
      // Two markups of the same elements are never equal, nor is their
      // data; each element's description is all its values.
      let of = rest.subelements.map { String(describing: $0) }.joined(separator: "\n")
      if let picture, picture.of == of { return picture.svg }
      let svg = await DrawingFile.picture(of: rest) ?? ""
      pictures += 1
      picture = (of, svg)
      return svg
    }

    /// The strokes' SVG, made afresh only for strokes neither an earlier
    /// save nor the file had.
    private func ink(of strokes: [PKStroke]) async -> String {
      let keys = strokes.map(InkOutline.key)
      var kept: [InkOutline.Key: (name: String, svg: String)] = [:]
      var missing: [Int] = []
      for (i, key) in keys.enumerated() where kept[key] == nil {
        if let known = self.strokes[key] {
          kept[key] = known
          continue
        }
        let name = InkOutline.digest(of: key)
        if let svg = seeded[name] {
          kept[key] = (name, svg)
        } else {
          missing.append(i)
        }
      }
      let unique = Dictionary(missing.map { (keys[$0], $0) }, uniquingKeysWith: { first, _ in first })
      let looks = await InkOutline.looks(of: unique.values.map { strokes[$0] })
      for ((key, i), look) in zip(unique, looks) {
        var local = strokes[i]
        local.transform.tx = 0
        local.transform.ty = 0
        kept[key] = (InkOutline.digest(of: key), DrawingFile.stroke(local, look))
        built += 1
      }
      self.strokes = kept
      seeded = [:]

      var out = ""
      for (stroke, key) in zip(strokes, keys) {
        guard let made = kept[key] else { continue }
        let t = stroke.transform
        let place = t.tx == 0 && t.ty == 0 ? "" : " transform=\"translate(\(n(t.tx)) \(n(t.ty)))\""
        out += "  <g data-s=\"\(made.name)\"\(place)>\n\(made.svg)  </g>\n"
      }
      return out
    }
  }

  // -- Ink ------------------------------------------------------------

  /// A stroke's visible parts as `InkOutline` sweeps them: runs of curve,
  /// each stroked at its width, faded together. Inside the drawing's ink
  /// `<g>`, which has the fill and caps.
  static func stroke(_ stroke: PKStroke, _ look: InkOutline.Look) -> String {
    var out = ""
    for part in InkOutline.parts(of: stroke, look) {
      let (color, _) = hex(part.color)
      let opacity = part.opacity < 0.995 ? " opacity=\"\(n(part.opacity))\"" : ""
      let blend = part.multiply ? " style=\"mix-blend-mode:multiply\"" : ""
      out += "    <g stroke=\"\(color)\"\(opacity)\(blend)>\n"
      for run in part.runs {
        out += "      <path d=\"\(svg(run.path))\" stroke-width=\"\(n(run.width))\"/>\n"
      }
      out += "    </g>\n"
    }
    return out
  }

  /// A path as SVG path data: where it starts, then each point from the one
  /// before (relative, from the rounded point, so nothing drifts).
  private static func svg(_ path: CGPath) -> String {
    var d = ""
    var at = (x: 0.0, y: 0.0)
    path.applyWithBlock { element in
      let e = element.pointee
      let r = { (i: Int) in (x: rounded(e.points[i].x), y: rounded(e.points[i].y)) }
      let from = { (p: (x: Double, y: Double)) in "\(n(p.x - at.x)) \(n(p.y - at.y))" }
      switch e.type {
      case .moveToPoint:
        at = r(0)
        d += "M\(n(at.x)) \(n(at.y))"
      case .addLineToPoint:
        let p = r(0)
        d += "l\(from(p))"
        at = p
      case .addQuadCurveToPoint:
        let (c, p) = (r(0), r(1))
        d += "q\(from(c)) \(from(p))"
        at = p
      case .addCurveToPoint:
        let (c1, c2, p) = (r(0), r(1), r(2))
        d += "c\(from(c1)) \(from(c2)) \(from(p))"
        at = p
      case .closeSubpath: d += "z"
      @unknown default: break
      }
    }
    return d
  }

  private static func rounded(_ value: CGFloat) -> Double {
    (Double(value) * 100).rounded() / 100
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

  // -- Reading ------------------------------------------------------------

  /// Each `<g data-s="name">`'s contents in `ink`, by name.
  private static func strokes(in ink: Data) -> [String: String] {
    let marker = Array("<g data-s=\"".utf8)
    var found: [String: String] = [:]
    ink.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
      let bytes = raw.bindMemory(to: UInt8.self)
      let count = bytes.count
      func matches(_ pattern: [UInt8], at i: Int) -> Bool {
        guard i + pattern.count <= count else { return false }
        for (k, b) in pattern.enumerated() where bytes[i + k] != b { return false }
        return true
      }
      let openG = Array("<g".utf8)
      let closeG = Array("</g>".utf8)
      var i = 0
      while i < count {
        guard bytes[i] == UInt8(ascii: "<"), matches(marker, at: i) else {
          i += 1
          continue
        }
        var j = i + marker.count
        let nameStart = j
        while j < count, bytes[j] != UInt8(ascii: "\"") { j += 1 }
        let name = String(decoding: UnsafeBufferPointer(rebasing: bytes[nameStart..<min(j, count)]), as: UTF8.self)
        while j < count, bytes[j] != UInt8(ascii: ">") { j += 1 }
        j += 1
        let bodyStart = j
        // To the `</g>` that closes it: its parts are `<g>`s too.
        var depth = 1
        while j < count, depth > 0 {
          if bytes[j] == UInt8(ascii: "<") {
            if matches(closeG, at: j) {
              depth -= 1
              if depth == 0 { break }
              j += closeG.count
              continue
            }
            if matches(openG, at: j), j + 2 < count, bytes[j + 2] == UInt8(ascii: " ") || bytes[j + 2] == UInt8(ascii: ">") {
              depth += 1
            }
          }
          j += 1
        }
        guard depth == 0 else { break }
        // As `Writer` writes it: on its own lines, in its `<g>`.
        var start = bodyStart
        var end = j
        if start < end, bytes[start] == UInt8(ascii: "\n") { start += 1 }
        while end > start, bytes[end - 1] == UInt8(ascii: " ") { end -= 1 }
        found[name] = String(decoding: UnsafeBufferPointer(rebasing: bytes[start..<end]), as: UTF8.self)
        i = j + closeG.count
      }
    }
    return found
  }

  private static func text(between open: String, and close: String, in data: Data) -> String? {
    guard let start = data.range(of: Data(open.utf8)),
      let end = data.range(of: Data(close.utf8), in: start.upperBound..<data.endIndex)
    else { return nil }
    return String(decoding: data[start.upperBound..<end.lowerBound], as: UTF8.self)
  }

  /// The `<svg>` tag's viewBox: what the last save found drawn.
  private static func viewBox(in data: Data) -> CGRect? {
    guard let svg = data.range(of: Data("<svg".utf8)),
      let end = data.range(of: Data(">".utf8), in: svg.upperBound..<min(data.endIndex, svg.upperBound + 4096))
    else { return nil }
    let tag = String(decoding: data[svg.upperBound..<end.lowerBound], as: UTF8.self)
    guard let box = attribute("viewBox", in: tag) else { return nil }
    let values = box.split(separator: " ").compactMap { Double($0) }
    guard values.count == 4 else { return nil }
    return CGRect(x: values[0], y: values[1], width: values[2], height: values[3])
  }

  private static func attribute(_ name: String, in tag: String) -> String? {
    guard let start = tag.range(of: " \(name)=\"") else { return nil }
    guard let end = tag.range(of: "\"", range: start.upperBound..<tag.endIndex) else { return nil }
    return String(tag[start.upperBound..<end.lowerBound])
  }

  // -- Text ------------------------------------------------------------

  static func n(_ value: CGFloat) -> String {
    let rounded = (value * 100).rounded() / 100
    return rounded == rounded.rounded() ? String(Int(rounded)) : String(format: "%.2f", rounded)
  }

  private static func n(_ value: Double) -> String { n(CGFloat(value)) }

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

  static func unescape(_ text: String) -> String {
    text.replacingOccurrences(of: "&lt;", with: "<")
      .replacingOccurrences(of: "&gt;", with: ">")
      .replacingOccurrences(of: "&amp;", with: "&")
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
