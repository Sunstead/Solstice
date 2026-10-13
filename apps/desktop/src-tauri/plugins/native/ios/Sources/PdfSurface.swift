import PDFKit
import UIKit

/// A PDF, in PDFKit: Apple's scrolling, zoom and text selection.
final class PdfSurface: SurfaceView {
  private let pdfView = PDFView()

  override init(id: String, path: String, plugin: NativePlugin) {
    super.init(id: id, path: path, plugin: plugin)
    pdfView.frame = bounds
    pdfView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    pdfView.displayMode = .singlePageContinuous
    pdfView.displayDirection = .vertical
    pdfView.autoScales = true
    pdfView.pageShadowsEnabled = true
    // Room around each page, as Preview leaves.
    pdfView.displaysPageBreaks = true
    pdfView.pageBreakMargins = UIEdgeInsets(top: 12, left: 16, bottom: 12, right: 16)
    // The host's colour (the theme's background) shows around the pages.
    pdfView.backgroundColor = .clear
    addSubview(pdfView)
    load()
  }

  private func load() {
    let url = URL(fileURLWithPath: path)
    guard let document = PDFDocument(url: url) else {
      send("error", message: "Couldn't open this PDF.")
      return
    }
    pdfView.document = document
  }

  override func reload() {
    // Back to the same page, and the same zoom if the reader had zoomed.
    let page = pdfView.currentPage.flatMap { pdfView.document?.index(for: $0) }
    let scale = pdfView.scaleFactor
    let zoomed = fitted.map { abs(scale - $0) >= 0.001 } ?? false
    load()
    if zoomed {
      pdfView.scaleFactor = scale
    } else {
      pdfView.autoScales = true
      fitted = pdfView.scaleFactor
    }
    if let page, let target = pdfView.document?.page(at: page) { pdfView.go(to: target) }
  }

  // -- Find ------------------------------------------------------------

  private var matches: [PDFSelection] = []
  private var active = -1

  override func find(_ query: String, caseSensitive: Bool, wholeWord: Bool) -> Int {
    matches = []
    active = -1
    defer { showMatches() }
    guard !query.isEmpty, let document = pdfView.document else { return 0 }
    var pattern = NSRegularExpression.escapedPattern(for: query)
    if wholeWord { pattern = "\\b\(pattern)\\b" }
    guard
      let regex = try? NSRegularExpression(
        pattern: pattern, options: caseSensitive ? [] : [.caseInsensitive])
    else { return 0 }
    for index in 0..<document.pageCount {
      guard let page = document.page(at: index), let text = page.string else { continue }
      let range = NSRange(text.startIndex..., in: text)
      for match in regex.matches(in: text, range: range) {
        if let selection = page.selection(for: match.range) { matches.append(selection) }
      }
    }
    if !matches.isEmpty { active = 0 }
    return matches.count
  }

  override func findStep(_ direction: Int) -> Int {
    guard !matches.isEmpty else { return -1 }
    active = (active + direction + matches.count) % matches.count
    showMatches()
    return active
  }

  private func showMatches() {
    for (index, match) in matches.enumerated() {
      match.color = index == active ? .systemOrange : .systemYellow.withAlphaComponent(0.5)
    }
    pdfView.highlightedSelections = matches.isEmpty ? nil : matches
    if matches.indices.contains(active) { pdfView.go(to: matches[active]) }
  }

  /// The width-fitting scale last applied: still showing it means the reader
  /// hasn't zoomed, so a new frame (the sidebar, a rotation) refits.
  private var fitted: CGFloat?

  override func layoutSubviews() {
    super.layoutSubviews()
    guard pdfView.document != nil, bounds.width > 0 else { return }
    let first = fitted == nil
    if first || abs(pdfView.scaleFactor - (fitted ?? 0)) < 0.001 {
      // Setting it again refits; PDFView doesn't on its own once laid out.
      pdfView.autoScales = true
      fitted = pdfView.scaleFactor
    }
    // Opens at the top of the first page, not wherever the first fit left it.
    if first { DispatchQueue.main.async { self.pdfView.goToFirstPage(nil) } }
  }
}
