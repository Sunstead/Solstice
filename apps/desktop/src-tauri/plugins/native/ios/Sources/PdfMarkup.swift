import PDFKit
import PaperKit
import UIKit

/// What Solstice writes into a PDF page: the page's PaperKit markup, so it
/// can be edited again, and a copy any reader draws: a stamp whose
/// appearance is PaperKit's own rendering of the markup (ink textures,
/// shapes, text, stickers, all as they look here), plus a link annotation
/// per link. `PdfStore` writes them; this makes them from the markup. Both
/// carry `key`; what other apps added (Preview's, Acrobat's) is left alone.
enum PdfMarkup {
  static let key = PDFAnnotationKey(rawValue: "/SolsticeMarkup")
  private static let legacyPrefix = "paperkit:"
  private static let copyValue = "copy"

  /// Hides or shows the page's copy on screen: while the page's markup is
  /// on screen, it draws itself. Only for the PDFKit document on screen;
  /// what's written to the file is `PdfStore`'s.
  static func showCopies(_ show: Bool, on page: PDFPage) {
    for annotation in page.annotations
    where annotation.value(forAnnotationKey: key) as? String == copyValue {
      annotation.shouldDisplay = show
    }
  }

  /// The page's marks as `PdfStore` writes them; nil when there are none.
  static func edit(of markup: PaperMarkup, page: PDFPage, index: Int) async throws -> PdfStore.Edit {
    guard !markup.subelements.ids.isEmpty else { return PdfStore.Edit(page: index, markup: nil) }
    let data = try await markup.dataRepresentation()
    let text = await markup.indexableContent ?? ""
    let box = page.bounds(for: .cropBox)
    let art = await render(markup, size: box.size)
    let links = self.links(in: markup, box: box).map {
      PdfStore.Link(rect: [$0.frame.minX, $0.frame.minY, $0.frame.maxX, $0.frame.maxY], url: $0.url.absoluteString)
    }
    return PdfStore.Edit(
      page: index,
      markup: PdfStore.Markup(
        data: data.base64EncodedString(), text: text, art: art?.base64EncodedString(), links: links))
  }

  /// The markup's links, in page space.
  private static func links(in markup: PaperMarkup, box: CGRect) -> [(frame: CGRect, url: URL)] {
    // Markup space has its origin top-left; the page's is bottom-left.
    let toPage = CGAffineTransform(a: 1, b: 0, c: 0, d: -1, tx: box.minX, ty: box.maxY)
    return markup.subelements.ids.compactMap { id in
      guard case .link(let linkID) = id, let link = markup.subelements[linkID] else { return nil }
      return (link.frame.applying(toPage), link.url)
    }
  }

  /// The markup as a one-page PDF the size of the page: vector where
  /// PaperKit draws vectors.
  private static func render(_ markup: PaperMarkup, size: CGSize) async -> Data? {
    let data = NSMutableData()
    var mediaBox = CGRect(origin: .zero, size: size)
    guard let consumer = CGDataConsumer(data: data as CFMutableData),
      let context = CGContext(consumer: consumer, mediaBox: &mediaBox, nil)
    else { return nil }
    context.beginPDFPage(nil)
    context.translateBy(x: 0, y: size.height)
    context.scaleBy(x: 1, y: -1)
    await markup.draw(
      in: context, frame: mediaBox, options: RenderingOptions(darkUserInterfaceStyle: false))
    context.endPDFPage()
    context.closePDF()
    return data as Data
  }

  // -- Encrypted PDFs ------------------------------------------------------
  // `PdfStore` won't write an encrypted PDF (it would drop the encryption),
  // so PDFKit writes those, in the old form: the markup as a base64 string.

  /// The page's markup as PDFKit sees it.
  static func read(_ page: PDFPage) -> PaperMarkup? {
    for annotation in page.annotations {
      guard let value = annotation.value(forAnnotationKey: key) as? String,
        value.hasPrefix(legacyPrefix),
        let data = Data(base64Encoded: String(value.dropFirst(legacyPrefix.count)))
      else { continue }
      return try? PaperMarkup(dataRepresentation: data)
    }
    return nil
  }

  /// Replaces what Solstice wrote on `page` with `markup`, in PDFKit's
  /// document. Write the document with `PdfMarkup.writeWithPDFKit`.
  static func replace(_ markup: PaperMarkup, on page: PDFPage) async throws {
    let data = try await markup.dataRepresentation()
    let text = await markup.indexableContent
    let box = page.bounds(for: .cropBox)
    let art = await render(markup, size: box.size)
      .flatMap { CGDataProvider(data: $0 as CFData) }
      .flatMap { CGPDFDocument($0)?.page(at: 1) }

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
    hidden.setValue(legacyPrefix + data.base64EncodedString(), forAnnotationKey: key)
    page.addAnnotation(hidden)

    if let art {
      let copy = Copy(bounds: box, forType: .stamp, withProperties: nil)
      copy.art = art
      copy.contents = text
      copy.setValue(copyValue, forAnnotationKey: key)
      page.addAnnotation(copy)
    }
    for link in links(in: markup, box: box) {
      let annotation = PDFAnnotation(bounds: link.frame, forType: .link, withProperties: nil)
      annotation.action = PDFActionURL(url: link.url)
      annotation.setValue(copyValue, forAnnotationKey: key)
      page.addAnnotation(annotation)
    }
  }

  /// Writes `document` to `path` through a temporary file. The copies are
  /// shown while it's written (hidden ones would be written hidden from
  /// every reader), and hidden again before anything draws.
  static func writeWithPDFKit(_ document: PDFDocument, to path: String) -> Bool {
    let pages = (0..<document.pageCount).compactMap { document.page(at: $0) }
    pages.forEach { showCopies(true, on: $0) }
    defer { pages.forEach { showCopies(false, on: $0) } }
    let url = URL(fileURLWithPath: path)
    let temporary = url.deletingLastPathComponent().appendingPathComponent(".\(url.lastPathComponent).saving")
    guard document.write(to: temporary) else { return false }
    if (try? FileManager.default.replaceItemAt(url, withItemAt: temporary)) != nil { return true }
    try? FileManager.default.removeItem(at: temporary)
    return false
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
