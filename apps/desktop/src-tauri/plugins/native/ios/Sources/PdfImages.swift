import CoreGraphics
import Foundation

/// Where a PDF page draws pictures (photographs, figures), in the page's
/// user space: a dark page inverts everything but them, which keep their true
/// colours. A scan that is the whole page, or a stencil mask (the ink of a
/// scan), is the page's own text: inverted with it, so not listed.
enum PdfImages {
  /// A picture this much of the page or more is the page itself.
  static let pageFraction: CGFloat = 0.6

  static func photos(on page: CGPDFPage) -> [CGRect] {
    let box = page.getBoxRect(.cropBox)
    let stream = CGPDFContentStreamCreateWithPage(page)
    defer { CGPDFContentStreamRelease(stream) }
    let walk = Walk(area: box.width * box.height)
    walk.scan(stream)
    return walk.rects
  }

  /// One walk of a content stream (and the forms it draws): the transform in
  /// force, saved and restored with q and Q.
  private final class Walk {
    var rects: [CGRect] = []
    private var matrix = CGAffineTransform.identity
    private var saved: [CGAffineTransform] = []
    private let area: CGFloat
    private var depth = 0

    init(area: CGFloat) { self.area = area }

    func scan(_ stream: CGPDFContentStreamRef) {
      guard let table = CGPDFOperatorTableCreate() else { return }
      CGPDFOperatorTableSetCallback(table, "q") { _, info in
        let w = Walk.of(info)
        w.saved.append(w.matrix)
      }
      CGPDFOperatorTableSetCallback(table, "Q") { _, info in
        let w = Walk.of(info)
        if let last = w.saved.popLast() { w.matrix = last }
      }
      CGPDFOperatorTableSetCallback(table, "cm") { scanner, info in
        var v = [CGPDFReal](repeating: 0, count: 6)
        var ok = true
        // Operands pop last first.
        for i in (0..<6).reversed() { ok = ok && CGPDFScannerPopNumber(scanner, &v[i]) }
        guard ok else { return }
        let w = Walk.of(info)
        w.matrix = CGAffineTransform(a: v[0], b: v[1], c: v[2], d: v[3], tx: v[4], ty: v[5]).concatenating(w.matrix)
      }
      CGPDFOperatorTableSetCallback(table, "Do") { scanner, info in
        var name: UnsafePointer<CChar>?
        guard CGPDFScannerPopName(scanner, &name), let name else { return }
        let w = Walk.of(info)
        w.draw(String(cString: name), in: CGPDFScannerGetContentStream(scanner))
      }
      let scanner = CGPDFScannerCreate(stream, table, Unmanaged.passUnretained(self).toOpaque())
      CGPDFScannerScan(scanner)
      CGPDFScannerRelease(scanner)
      CGPDFOperatorTableRelease(table)
    }

    private static func of(_ info: UnsafeMutableRawPointer?) -> Walk {
      Unmanaged<Walk>.fromOpaque(info!).takeUnretainedValue()
    }

    private func draw(_ name: String, in stream: CGPDFContentStreamRef?) {
      guard let stream, let object = CGPDFContentStreamGetResource(stream, "XObject", name) else { return }
      var xobject: CGPDFStreamRef?
      guard CGPDFObjectGetValue(object, .stream, &xobject), let xobject, let dict = CGPDFStreamGetDictionary(xobject)
      else { return }
      var subtype: UnsafePointer<CChar>?
      CGPDFDictionaryGetName(dict, "Subtype", &subtype)
      switch subtype.map(String.init(cString:)) {
      case "Image":
        var stencil: CGPDFBoolean = 0
        CGPDFDictionaryGetBoolean(dict, "ImageMask", &stencil)
        let frame = CGRect(x: 0, y: 0, width: 1, height: 1).applying(matrix)
        guard stencil == 0, frame.width * frame.height < area * PdfImages.pageFraction else { return }
        rects.append(frame)
      case "Form":
        // Its own matrix, then its own content (and resources).
        guard depth < 8 else { return }
        let form = CGPDFContentStreamCreateWithStream(xobject, dict, stream)
        let before = (matrix, saved)
        var m = [CGPDFReal](repeating: 0, count: 6)
        var array: CGPDFArrayRef?
        if CGPDFDictionaryGetArray(dict, "Matrix", &array), let array {
          for i in 0..<6 { CGPDFArrayGetNumber(array, i, &m[i]) }
          matrix = CGAffineTransform(a: m[0], b: m[1], c: m[2], d: m[3], tx: m[4], ty: m[5]).concatenating(matrix)
        }
        depth += 1
        scan(form)
        depth -= 1
        (matrix, saved) = before
        CGPDFContentStreamRelease(form)
      default:
        return
      }
    }
  }
}
