import Foundation

// The app links the PDF writer's functions from Rust (`plugins/native/src/pdf.rs`).
// Here a read finds no marks and a save writes nothing and says it did, so a
// surface's save runs to its end.

@_cdecl("solstice_pdf_read")
func solsticePdfRead(_ path: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>? { nil }

@_cdecl("solstice_pdf_save")
func solsticePdfSave(_ path: UnsafePointer<CChar>, _ request: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>? {
  strdup(#"{"hash":"stand-in","size":0}"#)
}

@_cdecl("solstice_pdf_free")
func solsticePdfFree(_ answer: UnsafeMutablePointer<CChar>?) { free(answer) }
