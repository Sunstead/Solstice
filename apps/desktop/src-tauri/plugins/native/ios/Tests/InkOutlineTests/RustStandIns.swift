import Foundation
import os

// The app links the PDF writer's functions from Rust (`plugins/native/src/pdf.rs`).
// Here a read finds no marks (or what a test gives it) and a save writes
// nothing and says it did, so a surface's save runs to its end; the saves
// asked for are kept for tests to look at.

enum RustStandIns {
  /// What a read answers (`PdfStore.Opened`'s JSON), and the saves' requests.
  static let state = OSAllocatedUnfairLock(initialState: (read: String?.none, saves: [String]()))
}

@_cdecl("solstice_pdf_read")
func solsticePdfRead(_ path: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>? {
  RustStandIns.state.withLock { $0.read }.flatMap { strdup($0) }
}

@_cdecl("solstice_pdf_save")
func solsticePdfSave(_ path: UnsafePointer<CChar>, _ request: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>? {
  RustStandIns.state.withLock { $0.saves.append(String(cString: request)) }
  return strdup(#"{"hash":"stand-in","size":0}"#)
}

@_cdecl("solstice_pdf_free")
func solsticePdfFree(_ answer: UnsafeMutablePointer<CChar>?) { free(answer) }
