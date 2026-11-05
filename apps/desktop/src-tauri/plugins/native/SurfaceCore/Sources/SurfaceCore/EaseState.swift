import Foundation

#if canImport(CoreGraphics)
  import CoreGraphics
#endif

/// A native view through Zen switches (`SurfaceView.easeHold`): held at a
/// size that covers its pane throughout, its content eased with the page,
/// and only then given its new size. Switches can come faster than the
/// motion, so a new size mid-motion carries on from where it is.
public struct EaseState: Equatable, Sendable {
  public enum Phase: Equatable, Sendable { case idle, held, playing }

  public enum Hold: Equatable, Sendable {
    /// Nothing to hold: take the frame as it is.
    case none
    /// A switch began: keep `size`, the content shown as at `from`.
    case began
    /// Already held. `grew`: `size` is larger, lay out for it.
    /// `interrupted`: a new switch mid-motion, stop the content where it is.
    case kept(grew: Bool, interrupted: Bool)
  }

  public enum Play: Equatable, Sendable {
    case none
    case start
    /// Moving, or stopped mid-way by a new switch: on from where it is now.
    case restart
  }

  public private(set) var phase: Phase = .idle
  /// Played since the hold began: the content is no longer where it was held.
  public private(set) var played = false
  /// The size before the first switch: what the content shows until it plays.
  public private(set) var from = CGSize()
  /// Every size since the hold began, unioned: what the view keeps.
  public private(set) var size = CGSize()
  /// The latest size: taken at the end.
  public private(set) var target = CGSize()

  public init() {}

  public var isHeld: Bool { phase != .idle }

  /// A new size from the page during a switch. `canBegin`: the view can be
  /// held now (shown, its content loaded).
  public mutating func hold(from old: CGSize, to new: CGSize, canBegin: Bool = true) -> Hold {
    guard isHeld else {
      guard canBegin, old.width > 0, new.width > 0, old != new else { return .none }
      phase = .held
      from = old
      size = Self.union(old, new)
      target = new
      return .began
    }
    guard new != target else { return .kept(grew: false, interrupted: false) }
    let union = Self.union(size, new)
    let grew = union != size
    let interrupted = phase == .playing
    size = union
    target = new
    if interrupted { phase = .held }
    return .kept(grew: grew, interrupted: interrupted)
  }

  /// The page's motion started.
  public mutating func play() -> Play {
    switch phase {
    case .idle: return .none
    case .held:
      phase = .playing
      defer { played = true }
      return played ? .restart : .start
    case .playing: return .restart
    }
  }

  /// The latest switch is over: the size to take, if any was held.
  public mutating func end() -> CGSize? {
    guard isHeld else { return nil }
    let last = target
    self = EaseState()
    return last
  }

  static func union(_ a: CGSize, _ b: CGSize) -> CGSize {
    CGSize(width: max(a.width, b.width), height: max(a.height, b.height))
  }
}
