import Foundation

/// When to recognise a canvas's handwriting again for its file (a drawing's
/// `<desc>`, for other apps' search): paced while it's drawn on (at least
/// every 30 s, less often the longer it takes: a big drawing's took tens of
/// seconds), and on the save made when it's left, if that's quick.
public struct Recognition: Sendable {
  /// Past this, leaving a drawing doesn't wait for its handwriting: the
  /// text in the file stays until the next paced recognition.
  public static let finalBudget: TimeInterval = 2

  /// The text last recognised, if any.
  public private(set) var text: String?
  /// Goes up with every change to the canvas.
  public private(set) var generation = 0
  /// Starts current: an untouched canvas's file already says what it says.
  private var recognisedGeneration = 0
  private var recognisedAt: Date?
  private var pacing = Pacing(least: 30)

  public init() {}

  /// As the file has it: `text` (its `<desc>`), as of `at`, expected to take
  /// `cost` to recognise again.
  public init(text: String?, at: Date, cost: TimeInterval) {
    self.text = text
    recognisedAt = text == nil ? nil : at
    pacing.took(cost)
  }

  public mutating func changed() {
    generation += 1
  }

  /// Whether a save now should recognise afresh: something changed since
  /// the text was recognised, and it's a while since (or there's no text
  /// yet), or it's the last save before the canvas is left (`final`) and
  /// recognising is quick.
  public func isDue(now: Date, final: Bool) -> Bool {
    guard recognisedGeneration != generation else { return false }
    guard let at = recognisedAt, text != nil else { return true }
    if final && pacing.cost <= Self.finalBudget { return true }
    return now.timeIntervalSince(at) >= pacing.wait
  }

  /// `text` was recognised from the canvas as it was at `asked`, taking `took`.
  public mutating func recognised(_ text: String, of asked: Int, at now: Date, took: TimeInterval = 0) {
    self.text = text
    recognisedGeneration = asked
    recognisedAt = now
    pacing.took(took)
  }
}
