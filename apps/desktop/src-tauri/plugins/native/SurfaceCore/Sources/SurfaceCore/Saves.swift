/// A surface's saves, one at a time, in the order asked for: each waits for
/// the one before it.
///
/// Chained, not polled: waiting in a loop for "the save under way" spun
/// forever when a waiter of higher priority resumed before the save's owner
/// could clear it (awaiting a finished task doesn't yield), freezing the
/// main thread.
@MainActor
public final class Saves {
  private var last: Task<Void, Never>?

  public init() {}

  /// A save is under way, or waiting its turn.
  public var running: Bool { last != nil }

  /// Runs `work` once every save asked for before it is done; returns when
  /// it is.
  public func run(_ work: @escaping @MainActor () async -> Void) async {
    let previous = last
    let task = Task { @MainActor in
      await previous?.value
      await work()
    }
    last = task
    await task.value
    if last == task { last = nil }
  }
}
