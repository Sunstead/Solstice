// The app links the PDF writer's functions from Rust (`plugins/native/src/pdf.rs`);
// the tests never call them, but the plugin's code needs them to link.

@_cdecl("solstice_pdf_read")
func solsticePdfRead(_ path: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>? { nil }

@_cdecl("solstice_pdf_save")
func solsticePdfSave(_ path: UnsafePointer<CChar>, _ request: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>? {
  nil
}

@_cdecl("solstice_pdf_free")
func solsticePdfFree(_ answer: UnsafeMutablePointer<CChar>?) {}
