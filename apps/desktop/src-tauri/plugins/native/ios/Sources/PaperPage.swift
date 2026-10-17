import PDFKit
import UIKit

/// A PDF page that can be shown on dark paper. The file is never touched: only
/// how PDFKit draws the page changes, so what Solstice, Preview and every
/// other reader see in the file is the page as it was.
///
/// Dark is the page inverted in lightness with its hues kept (white paper
/// goes to `Paper.ground`, black text to light grey, a red heading stays
/// red), with its pictures drawn as they are.
final class PaperPage: PDFPage {
  /// Whether pages are drawn dark. One value for the app (`Ink.darkPaper`).
  nonisolated(unsafe) static var dark = false

  private lazy var photos: [CGRect] = {
    pageRef.map(PdfImages.photos(on:)) ?? []
  }()

  override func draw(with box: PDFDisplayBox, to context: CGContext) {
    guard Self.dark else { return super.draw(with: box, to: context) }
    let area = bounds(for: box)
    context.saveGState()
    defer { context.restoreGState() }
    context.clip(to: area)

    // The page as it is: the hues.
    context.setFillColor(UIColor.white.cgColor)
    context.fill(area)
    super.draw(with: box, to: context)

    // The page inverted, laid over it for its lightness alone.
    context.setBlendMode(.luminosity)
    context.beginTransparencyLayer(in: area, auxiliaryInfo: nil)
    context.setBlendMode(.normal)
    context.setFillColor(UIColor.white.cgColor)
    context.fill(area)
    super.draw(with: box, to: context)
    context.setBlendMode(.difference)
    context.fill(area)
    context.endTransparencyLayer()

    // Not pure white on black: text a little softer, the paper the ground.
    context.setBlendMode(.multiply)
    context.setFillColor(Paper.text.cgColor)
    context.fill(area)
    context.setBlendMode(.lighten)
    context.setFillColor(Paper.ground.cgColor)
    context.fill(area)

    // Pictures as they are.
    context.setBlendMode(.normal)
    for photo in photos {
      context.saveGState()
      context.clip(to: photo.intersection(area))
      context.setFillColor(UIColor.white.cgColor)
      context.fill(area)
      super.draw(with: box, to: context)
      context.restoreGState()
    }
  }
}

/// Makes a document's pages `PaperPage`s.
final class PaperPages: NSObject, PDFDocumentDelegate {
  static let shared = PaperPages()

  func classForPage() -> AnyClass { PaperPage.self }

  func document(at url: URL) -> PDFDocument? {
    let document = PDFDocument(url: url)
    document?.delegate = self
    return document
  }

  func document(data: Data) -> PDFDocument? {
    let document = PDFDocument(data: data)
    document?.delegate = self
    return document
  }
}
