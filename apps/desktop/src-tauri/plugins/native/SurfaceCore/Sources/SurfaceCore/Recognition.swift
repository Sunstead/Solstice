import Foundation

/// When to recognise a canvas's handwriting again for its file (a drawing's
/// `<desc>`, a PDF page's text, for other apps' search): at most every
/// `interval` while it's drawn on, and on the save made when it's left.
/// Recognising the whole canvas took about half a second of every save.
public struct Recognition: Sendable {
  public static let interval: TimeInterval = 30

  /// The text last recognised, if any.
  public private(set) var text: String?
  /// Goes up with every change to the canvas.
  public private(set) var generation = 0
  /// Starts current: an untouched canvas's file already says what it says.
  private var recognisedGeneration = 0
  private var recognisedAt: Date?

  public init() {}

  public mutating func changed() {
    generation += 1
  }

  /// Whether a save now should recognise afresh: something changed since
  /// the text was recognised, and it's a while since, or there's no text
  /// yet, or it's the last save before the canvas is left (`final`).
  public func isDue(now: Date, final: Bool) -> Bool {
    guard recognisedGeneration != generation else { return false }
    guard let at = recognisedAt, text != nil else { return true }
    return final || now.timeIntervalSince(at) >= Self.interval
  }

  /// `text` was recognised from the canvas as it was at `asked`.
  public mutating func recognised(_ text: String, of asked: Int, at now: Date) {
    self.text = text
    recognisedGeneration = asked
    recognisedAt = now
  }
}
