import Foundation

/// How long to wait before costly work runs again (a big drawing's save, its
/// handwriting recognised): at least `least`, at most `most`, and long
/// enough that the work takes at most `share` of the time. A huge drawing
/// took seconds a save, every 3 s while it was written on.
public struct Pacing: Sendable {
  public let least: TimeInterval
  public let most: TimeInterval
  public let share: Double
  /// How long the work last took (or is expected to).
  public private(set) var cost: TimeInterval = 0

  public init(least: TimeInterval, most: TimeInterval = .infinity, share: Double = 0.1) {
    self.least = least
    self.most = most
    self.share = share
  }

  public mutating func took(_ seconds: TimeInterval) {
    cost = max(0, seconds)
  }

  public var wait: TimeInterval {
    min(most, max(least, cost / share))
  }
}
