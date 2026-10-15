import PDFKit
import UIKit

/// A notebook is a PDF of A4 pages with a background (blank, lined, grid or
/// dotted), marked up like any other PDF. The background is drawn into each
/// page, and named in the document's keywords (PDFKit drops attributes of
/// its own) so new pages match.
enum Notebook {
  /// A4, in points.
  static let a4 = CGRect(x: 0, y: 0, width: 595.28, height: 841.89)
  private static let templateKeyword = "solstice-template:"

  /// A new notebook with one page, at `url`.
  static func create(at url: URL, template: String) throws {
    guard let page = page(template: template, size: a4) else {
      throw CocoaError(.fileWriteUnknown)
    }
    let document = PDFDocument()
    document.insert(page, at: 0)
    var attributes = document.documentAttributes ?? [:]
    attributes[PDFDocumentAttribute.keywordsAttribute] = [templateKeyword + template]
    attributes[PDFDocumentAttribute.creatorAttribute] = "Solstice"
    document.documentAttributes = attributes
    guard document.write(to: url) else { throw CocoaError(.fileWriteUnknown) }
  }

  /// The template a document's new pages get: its own, or blank.
  static func template(of document: PDFDocument) -> String {
    let keywords = document.documentAttributes?[PDFDocumentAttribute.keywordsAttribute]
    let all = (keywords as? [String]) ?? (keywords as? String).map { [$0] } ?? []
    let tagged = all.first { $0.hasPrefix(templateKeyword) }
    return tagged.map { String($0.dropFirst(templateKeyword.count)) } ?? "blank"
  }

  /// One page of `template`, `size` big.
  static func page(template: String, size: CGRect) -> PDFPage? {
    pageData(template: template, size: size).flatMap { PDFDocument(data: $0)?.page(at: 0) }
  }

  /// One page of `template`, `size` big, as a one-page PDF.
  static func pageData(template: String, size: CGRect) -> Data? {
    UIGraphicsPDFRenderer(bounds: size).pdfData { context in
      context.beginPage()
      draw(template, in: size, context.cgContext)
    }
  }

  /// Quiet enough to write over, and to print.
  private static let ink = UIColor(white: 0.78, alpha: 1).cgColor
  /// 5 mm.
  private static let grid: CGFloat = 14.17
  /// About 8.5 mm, a college-ruled line.
  private static let ruled: CGFloat = 24

  private static func draw(_ template: String, in rect: CGRect, _ context: CGContext) {
    context.setFillColor(UIColor.white.cgColor)
    context.fill(rect)
    context.setStrokeColor(ink)
    context.setFillColor(ink)
    context.setLineWidth(0.5)
    switch template {
    case "lined":
      var y = rect.minY + 72
      while y < rect.maxY - 36 {
        context.move(to: CGPoint(x: rect.minX + 36, y: y))
        context.addLine(to: CGPoint(x: rect.maxX - 36, y: y))
        y += ruled
      }
      context.strokePath()
    case "grid":
      var x = rect.minX + grid
      while x < rect.maxX {
        context.move(to: CGPoint(x: x, y: rect.minY))
        context.addLine(to: CGPoint(x: x, y: rect.maxY))
        x += grid
      }
      var y = rect.minY + grid
      while y < rect.maxY {
        context.move(to: CGPoint(x: rect.minX, y: y))
        context.addLine(to: CGPoint(x: rect.maxX, y: y))
        y += grid
      }
      context.strokePath()
    case "dotted":
      var y = rect.minY + grid
      while y < rect.maxY {
        var x = rect.minX + grid
        while x < rect.maxX {
          context.fillEllipse(in: CGRect(x: x - 0.75, y: y - 0.75, width: 1.5, height: 1.5))
          x += grid
        }
        y += grid
      }
    default:
      break
    }
  }
}
