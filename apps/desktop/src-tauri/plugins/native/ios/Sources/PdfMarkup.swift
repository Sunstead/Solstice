import PDFKit
import PaperKit
import PencilKit
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
  /// `absorbed`: Apple's annotations whose ink is in `markup`.
  static func edit(
    of markup: PaperMarkup, page: PDFPage, index: Int, absorbed: [String] = []
  ) async throws -> PdfStore.Edit {
    guard !markup.subelements.ids.isEmpty else {
      return PdfStore.Edit(page: index, markup: nil, absorbed: absorbed)
    }
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
        data: data.base64EncodedString(), text: text, art: art?.base64EncodedString(), links: links),
      absorbed: absorbed)
  }

  // -- Apple's Markup -------------------------------------------------------
  // Preview and Files write ink as a stamp whose appearance is a picture,
  // blurred at any zoom; the ink itself, in vector, is a `PKDrawing` in the
  // annotation's archive. Solstice draws that instead, on the page's canvas.

  /// The ink in an annotation of Apple's Markup, in markup space; nil for
  /// anything else of Apple's (a text box, a shape), which PDFKit draws.
  static func appleInk(_ archive: Data, rect: CGRect, box: CGRect) -> PKDrawing? {
    guard
      let plist = try? PropertyListSerialization.propertyList(from: archive, format: nil) as? [String: Any],
      let objects = plist["$objects"] as? [Any],
      let drawing = objects.lazy.compactMap({ ($0 as? Data).flatMap { try? PKDrawing(data: $0) } }).first,
      !drawing.strokes.isEmpty
    else { return nil }
    // Apple keeps it in the page's space, origin top-left, as markup is; a
    // drawing the annotation's size is moved onto the annotation, in case
    // the page's box doesn't start at zero.
    let target = CGRect(x: rect.minX - box.minX, y: box.maxY - rect.maxY, width: rect.width, height: rect.height)
    let bounds = drawing.bounds
    guard abs(bounds.width - target.width) < 4, abs(bounds.height - target.height) < 4 else { return drawing }
    return drawing.transformed(
      using: CGAffineTransform(translationX: target.minX - bounds.minX, y: target.minY - bounds.minY))
  }

  /// Hides Apple's picture of the ink at `rect` on screen: the canvas draws it.
  static func hideAppleInk(at rect: CGRect, on page: PDFPage) {
    for annotation in page.annotations
    where annotation.value(forAnnotationKey: key) == nil
      && abs(annotation.bounds.minX - rect.minX) < 1 && abs(annotation.bounds.minY - rect.minY) < 1
      && abs(annotation.bounds.width - rect.width) < 1 && abs(annotation.bounds.height - rect.height) < 1
    {
      annotation.shouldDisplay = false
    }
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

  /// The markup as a one-page PDF the size of the page. Ink is vector
  /// (`InkOutline`), sharp at any zoom in every reader: PaperKit draws ink as
  /// a bitmap. Shapes, text and stickers are as PaperKit draws them, under it.
  private static func render(_ markup: PaperMarkup, size: CGSize) async -> Data? {
    let data = NSMutableData()
    var mediaBox = CGRect(origin: .zero, size: size)
    guard let consumer = CGDataConsumer(data: data as CFMutableData),
      let context = CGContext(consumer: consumer, mediaBox: &mediaBox, nil)
    else { return nil }
    context.beginPDFPage(nil)
    context.translateBy(x: 0, y: size.height)
    context.scaleBy(x: 1, y: -1)
    var rest = markup
    for id in markup.subelements.ids {
      if case .stroke = id { _ = rest.subelements.removeElement(for: id) }
    }
    if !rest.subelements.ids.isEmpty {
      await rest.draw(in: context, frame: mediaBox, options: RenderingOptions(darkUserInterfaceStyle: false))
    }
    let strokes = Array(markup.subelements.strokes)
    for (stroke, look) in zip(strokes, await InkOutline.looks(of: strokes)) {
      InkOutline.draw(stroke, look, in: context)
    }
    context.endPDFPage()
    context.closePDF()
    return data as Data
  }

  /// The marks as a picture `size` across (a page's thumbnail), drawn by
  /// PaperKit in their true colours, on nothing.
  static func picture(of markup: PaperMarkup, size: CGSize, scale: CGFloat) async -> CGImage? {
    let width = Int(size.width * scale)
    let height = Int(size.height * scale)
    guard width > 0, height > 0, markup.bounds.width > 0,
      let context = CGContext(
        data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { return nil }
    // Markup space is y down; PaperKit draws in it whatever the frame, so
    // the context moves instead.
    context.translateBy(x: 0, y: CGFloat(height))
    context.scaleBy(x: CGFloat(width) / markup.bounds.width, y: -CGFloat(height) / markup.bounds.height)
    await markup.draw(in: context, frame: markup.bounds, options: RenderingOptions(darkUserInterfaceStyle: false))
    return context.makeImage()
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
