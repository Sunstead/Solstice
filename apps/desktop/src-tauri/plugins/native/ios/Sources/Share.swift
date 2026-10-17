import UIKit
import WebKit

/// Getting files out of the app: the share sheet (AirDrop, Messages, Save to
/// Files...), the Files picker for a copy, and a note's page printed to a PDF
/// (the page is built by the frontend, `lib/export/`).
@MainActor
enum Share {
  /// The share sheet for `urls`. On an iPad it's a popover from `rect`, in
  /// the webview's points. `done` hears when it's put away.
  static func present(
    _ urls: [URL], from rect: CGRect, in webview: WKWebView, by presenter: UIViewController,
    done: @escaping () -> Void
  ) {
    let sheet = UIActivityViewController(activityItems: urls, applicationActivities: nil)
    sheet.completionWithItemsHandler = { _, _, _, _ in done() }
    if let popover = sheet.popoverPresentationController {
      popover.sourceView = webview
      popover.sourceRect = rect
    }
    presenter.present(sheet, animated: true)
  }

  /// The Files picker, saving a copy of each of `urls` where it's put.
  static func export(_ urls: [URL], by presenter: UIViewController, done: @escaping (Bool) -> Void) {
    let picker = UIDocumentPickerViewController(forExporting: urls, asCopy: true)
    let delegate = PickerDelegate(done)
    picker.delegate = delegate
    // The picker holds its delegate weakly.
    PickerDelegate.current = delegate
    presenter.present(picker, animated: true)
  }
}

private final class PickerDelegate: NSObject, UIDocumentPickerDelegate {
  static var current: PickerDelegate?
  private let done: (Bool) -> Void

  init(_ done: @escaping (Bool) -> Void) {
    self.done = done
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    done(true)
    Self.current = nil
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    done(false)
    Self.current = nil
  }
}

/// A page to print on, in points.
struct PageSpec: Decodable {
  let width: Double
  let height: Double
  let margin: Double
}

/// HTML to a paginated PDF: an offscreen web view lays the page out, and
/// UIKit's print renderer cuts it into pages of `PageSpec`. One at a time.
@MainActor
enum PdfPrinter {
  private static var last: Task<Void, Never>?

  static func render(html: String, page: PageSpec, to url: URL) async throws {
    let previous = last
    let task = Task { @MainActor () -> Result<Void, Error> in
      await previous?.value
      do {
        try await renderNow(html: html, page: page, to: url)
        return .success(())
      } catch {
        return .failure(error)
      }
    }
    last = Task { _ = await task.value }
    try await task.value.get()
  }

  private static func renderNow(html: String, page: PageSpec, to url: URL) async throws {
    let paper = CGRect(x: 0, y: 0, width: page.width, height: page.height)
    let web = WKWebView(frame: paper)
    // In a window (out of sight) so WebKit lays it out as it would on screen.
    let window = UIApplication.shared.connectedScenes
      .compactMap { ($0 as? UIWindowScene)?.keyWindow }.first
    web.frame.origin = CGPoint(x: -paper.width - 100, y: 0)
    window?.addSubview(web)
    defer { web.removeFromSuperview() }

    let loaded = Loaded()
    web.navigationDelegate = loaded
    web.loadHTMLString(html, baseURL: nil)
    try await loaded.wait()
    // Fonts in, pictures decoded: what prints is what the page shows.
    _ = try? await web.callAsyncJavaScript(
      """
      await document.fonts.ready;
      await Promise.all([...document.images].map((i) => i.decode().catch(() => {})));
      return true;
      """, contentWorld: .page)

    let renderer = PageRenderer(paper: paper, margin: page.margin)
    renderer.addPrintFormatter(web.viewPrintFormatter(), startingAtPageAt: 0)
    let data = NSMutableData()
    UIGraphicsBeginPDFContextToData(data, paper, nil)
    renderer.prepare(forDrawingPages: NSRange(location: 0, length: renderer.numberOfPages))
    for index in 0..<renderer.numberOfPages {
      UIGraphicsBeginPDFPage()
      renderer.drawPage(at: index, in: UIGraphicsGetPDFContextBounds())
    }
    UIGraphicsEndPDFContext()
    try data.write(to: url, options: .atomic)
  }
}

/// Paper of our size, not the printer's.
private final class PageRenderer: UIPrintPageRenderer {
  private let paper: CGRect
  private let margin: CGFloat

  init(paper: CGRect, margin: Double) {
    self.paper = paper
    self.margin = margin
  }

  override var paperRect: CGRect { paper }
  override var printableRect: CGRect { paper.insetBy(dx: margin, dy: margin) }
}

/// Resumes once the page has loaded (or failed to).
private final class Loaded: NSObject, WKNavigationDelegate {
  private var continuation: CheckedContinuation<Void, Error>?
  private var result: Result<Void, Error>?

  func wait() async throws {
    if let result { return try result.get() }
    try await withCheckedThrowingContinuation { self.continuation = $0 }
  }

  private func finish(_ result: Result<Void, Error>) {
    guard self.result == nil else { return }
    self.result = result
    continuation?.resume(with: result)
    continuation = nil
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    finish(.success(()))
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    finish(.failure(error))
  }

  func webView(
    _ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error
  ) {
    finish(.failure(error))
  }
}
