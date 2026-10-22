import CryptoKit
import Foundation

@_silgen_name("solstice_pdf_read")
private func solstice_pdf_read(_ path: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>?
@_silgen_name("solstice_pdf_save")
private func solstice_pdf_save(
  _ path: UnsafePointer<CChar>, _ request: UnsafePointer<CChar>
) -> UnsafeMutablePointer<CChar>?
@_silgen_name("solstice_pdf_free")
private func solstice_pdf_free(_ answer: UnsafeMutablePointer<CChar>?)

/// The PDF file itself, through Solstice's PDF writer (`solstice-pdf`, in
/// Rust): the marks read from it, and changed pages written into it, off the
/// main thread. PDFKit only shows the PDF; its own `write` kept every
/// annotation it ever removed, and two copies of each it kept.
enum PdfStore {
  struct Opened: Decodable {
    /// Each page's PaperKit data, in base64.
    let pages: [String?]
    /// Each page's annotations of Apple's Markup (Preview, Files).
    let apple: [[AppleInk]]?
    /// Written by an old save: rewrite it once.
    let needsRepair: Bool
  }

  /// An annotation of Apple's Markup: its archive (base64; an
  /// `AKInkAnnotation2`'s holds the ink as a `PKDrawing`), and its rect in
  /// page space (x0, y0, x1, y1).
  struct AppleInk: Decodable {
    let fingerprint: String
    let archive: String
    let rect: [CGFloat]
  }

  struct Saved: Decodable {
    /// SHA-256 of what's now on disk.
    let hash: String
  }

  struct Request: Encodable {
    var inserts: [Insert] = []
    var edits: [Edit] = []
    /// The pages' final order, after the inserts; pages left out are deleted.
    var order: [Int]? = nil
    var isEmpty: Bool { inserts.isEmpty && edits.isEmpty && order == nil }
  }

  /// A page added at `at`, from a one-page PDF.
  struct Insert: Encodable {
    let at: Int
    let pdf: String
  }

  /// A page's marks replaced, or removed (`markup` nil).
  struct Edit: Encodable {
    let page: Int
    let markup: Markup?
    /// Apple's annotations on the page whose ink is in `markup` now: they go.
    var absorbed: [String] = []
  }

  struct Markup: Encodable {
    let data: String
    let text: String
    /// The marks drawn as a one-page PDF, which every reader shows.
    let art: String?
    let links: [Link]
  }

  /// In page space: x0, y0, x1, y1.
  struct Link: Encodable {
    let rect: [CGFloat]
    let url: String
  }

  struct Failure: LocalizedError {
    let message: String
    var errorDescription: String? { message }
    /// An encrypted PDF: PDFKit keeps it.
    var encrypted: Bool { message == "This PDF is encrypted." }
  }

  static func read(_ path: String) async throws -> Opened {
    try await Task.detached(priority: .userInitiated) {
      try decode(Opened.self, path.withCString { solstice_pdf_read($0) })
    }.value
  }

  static func save(_ path: String, _ request: Request) async throws -> Saved {
    let json = String(decoding: try JSONEncoder().encode(request), as: UTF8.self)
    // Below the canvases' own drawing: a save can wait.
    return try await Task.detached(priority: .utility) {
      try decode(
        Saved.self,
        path.withCString { path in json.withCString { solstice_pdf_save(path, $0) } })
    }.value
  }

  /// SHA-256 of the file now, as `Saved.hash` reports a save.
  static func hash(_ path: String) async -> String? {
    await Task.detached(priority: .utility) {
      guard let data = FileManager.default.contents(atPath: path) else { return nil }
      return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }.value
  }

  private static func decode<T: Decodable>(_ type: T.Type, _ answer: UnsafeMutablePointer<CChar>?) throws -> T {
    defer { solstice_pdf_free(answer) }
    guard let answer else { throw Failure(message: "The PDF writer didn't answer.") }
    let data = Data(bytes: answer, count: strlen(answer))
    if let failed = try? JSONDecoder().decode([String: String].self, from: data), let error = failed["error"] {
      throw Failure(message: error)
    }
    return try JSONDecoder().decode(type, from: data)
  }
}
