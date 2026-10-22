/// Which of a PDF's page canvases PDFKit is showing, so one is let go only
/// once PDFKit has let go of its page and it has nothing left to save.
///
/// PDFKit keeps a page's overlay for a while after the page leaves the view,
/// and doesn't ask for it again while it does. A canvas let go then stayed on
/// the page, no longer the surface's: it took no new tools, and what was
/// drawn on it was never saved.
public struct PageCanvases<Key: Hashable> {
  public private(set) var displayed: Set<Key> = []

  public init() {}

  /// PDFKit put the canvas on its page.
  public mutating func shown(_ key: Key) {
    displayed.insert(key)
  }

  /// PDFKit took it off. Whether it can go now: not while it has unsaved
  /// marks, which keep it until they're saved (`afterSave`).
  public mutating func ended(_ key: Key, unsaved: Bool) -> Bool {
    displayed.remove(key)
    return !unsaved
  }

  /// The canvas went (the document reloaded, its page was deleted).
  public mutating func forget(_ key: Key) {
    displayed.remove(key)
  }

  /// After `saved` were written: those that can go now, being off their
  /// pages with nothing new to save.
  public func afterSave(_ saved: [Key], unsaved: Set<Key>) -> [Key] {
    saved.filter { !displayed.contains($0) && !unsaved.contains($0) }
  }
}
