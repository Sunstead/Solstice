import PDFKit
import PaperKit
import UIKit

/// What Solstice writes into a PDF page: the page's PaperKit markup, in one
/// hidden annotation so it can be edited again, and a copy any reader draws:
/// a stamp whose appearance is PaperKit's own rendering of the markup (ink
/// textures, shapes, text, stickers, all as they look here), plus a link
/// annotation per link. Both carry `key`; what other apps added (Preview's,
/// Acrobat's) is left alone.
enum PdfMarkup {
  static let key = PDFAnnotationKey(rawValue: "/SolsticeMarkup")
  private static let dataPrefix = "paperkit:"
  private static let copyValue = "copy"

  /// The page's markup, if Solstice wrote one.
  static func read(_ page: PDFPage) -> PaperMarkup? {
    for annotation in page.annotations {
      guard let value = annotation.value(forAnnotationKey: key) as? String,
        value.hasPrefix(dataPrefix),
        let data = Data(base64Encoded: String(value.dropFirst(dataPrefix.count)))
      else { continue }
      return try? PaperMarkup(dataRepresentation: data)
    }
    return nil
  }

  /// Hides or shows the page's copy: while the page's markup is on screen,
  /// it draws itself.
  static func showCopies(_ show: Bool, on page: PDFPage) {
    for annotation in page.annotations
    where annotation.value(forAnnotationKey: key) as? String == copyValue {
      annotation.shouldDisplay = show
    }
  }

  /// Replaces what Solstice wrote on `page` with `markup`.
  static func write(_ markup: PaperMarkup, to page: PDFPage) async throws {
    let data = try await markup.dataRepresentation()
    let text = await markup.indexableContent
    let box = page.bounds(for: .cropBox)
    let art = await render(markup, size: box.size)

    for annotation in page.annotations where annotation.value(forAnnotationKey: key) != nil {
      page.removeAnnotation(annotation)
    }
    guard !markup.subelements.ids.isEmpty else { return }

    let hidden = PDFAnnotation(
      bounds: CGRect(x: box.minX, y: box.minY, width: 1, height: 1), forType: .square,
      withProperties: nil)
    hidden.shouldDisplay = false
    hidden.shouldPrint = false
    hidden.contents = text
    hidden.setValue(dataPrefix + data.base64EncodedString(), forAnnotationKey: key)
    page.addAnnotation(hidden)

    if let art {
      let copy = Copy(bounds: box, forType: .stamp, withProperties: nil)
      copy.art = art
      copy.contents = text
      copy.setValue(copyValue, forAnnotationKey: key)
      page.addAnnotation(copy)
    }

    // Links stay links: the stamp only draws them.
    let toPage = CGAffineTransform(a: 1, b: 0, c: 0, d: -1, tx: box.minX, ty: box.maxY)
    for id in markup.subelements.ids {
      guard case .link(let linkID) = id, let link = markup.subelements[linkID] else { continue }
      let annotation = PDFAnnotation(
        bounds: link.frame.applying(toPage), forType: .link, withProperties: nil)
      annotation.action = PDFActionURL(url: link.url)
      annotation.setValue(copyValue, forAnnotationKey: key)
      page.addAnnotation(annotation)
    }
  }

  /// The markup as a one-page PDF the size of the page: vector where
  /// PaperKit draws vectors.
  private static func render(_ markup: PaperMarkup, size: CGSize) async -> CGPDFPage? {
    let data = NSMutableData()
    var mediaBox = CGRect(origin: .zero, size: size)
    guard let consumer = CGDataConsumer(data: data as CFMutableData),
      let context = CGContext(consumer: consumer, mediaBox: &mediaBox, nil)
    else { return nil }
    context.beginPDFPage(nil)
    // Markup space has its origin top-left, as UIKit draws.
    context.translateBy(x: 0, y: size.height)
    context.scaleBy(x: 1, y: -1)
    await markup.draw(
      in: context, frame: mediaBox, options: RenderingOptions(darkUserInterfaceStyle: false))
    context.endPDFPage()
    context.closePDF()
    guard let provider = CGDataProvider(data: data as CFData) else { return nil }
    return CGPDFDocument(provider)?.page(at: 1)
  }

  /// The copy's stamp: PDFKit records what it draws as its appearance when
  /// the document is written.
  private final class Copy: PDFAnnotation {
    var art: CGPDFPage?

    override func draw(with box: PDFDisplayBox, in context: CGContext) {
      guard let art else { return }
      context.saveGState()
      context.translateBy(x: bounds.minX, y: bounds.minY)
      context.drawPDFPage(art)
      context.restoreGState()
    }
  }
}
