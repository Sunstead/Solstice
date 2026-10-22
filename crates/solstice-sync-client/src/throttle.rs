//! When to look at the folder after it changes.

use std::time::Duration;

use tokio::time::Instant;

/// Soon after a first change (`settle`), then at most once every `every`
/// while changes keep coming, and at once when asked. An editor saving a
/// drawing or PDF every few seconds had the whole file read, hashed, copied
/// and uploaded after every save; now it goes up every `every` while it's
/// drawn on, and at once when it's left.
pub(crate) struct Throttle {
    settle: Duration,
    every: Duration,
    /// When the folder was last looked at.
    last: Option<Instant>,
    due: Option<Instant>,
}

impl Throttle {
    pub(crate) fn new(settle: Duration, every: Duration) -> Self {
        Throttle {
            settle,
            every,
            last: None,
            due: None,
        }
    }

    /// The folder changed at `now`; `at_once` to look without waiting.
    pub(crate) fn changed(&mut self, now: Instant, at_once: bool) {
        let at = if at_once {
            now
        } else {
            let soon = now + self.settle;
            self.last.map_or(soon, |last| soon.max(last + self.every))
        };
        self.due = Some(self.due.map_or(at, |due| due.min(at)));
    }

    /// When to look next, if there's anything to look at.
    pub(crate) fn due(&self) -> Option<Instant> {
        self.due
    }

    /// The folder was looked at.
    pub(crate) fn fired(&mut self, now: Instant) {
        self.last = Some(now);
        self.due = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;
    use tokio::time::Instant;

    const SETTLE: Duration = Duration::from_millis(800);
    const EVERY: Duration = Duration::from_secs(30);

    fn throttle() -> Throttle {
        Throttle::new(SETTLE, EVERY)
    }

    #[test]
    fn a_first_change_is_looked_at_soon() {
        let t0 = Instant::now();
        let mut t = throttle();
        assert_eq!(t.due(), None);
        t.changed(t0, false);
        assert_eq!(t.due(), Some(t0 + SETTLE));
    }

    /// A drawing saved every few seconds was read, hashed and uploaded whole
    /// on every save.
    #[test]
    fn changes_that_keep_coming_are_looked_at_every_so_often() {
        let t0 = Instant::now();
        let mut t = throttle();
        t.changed(t0, false);
        t.fired(t0 + SETTLE);
        assert_eq!(t.due(), None);
        for s in [3, 6, 9, 12] {
            t.changed(t0 + Duration::from_secs(s), false);
        }
        assert_eq!(t.due(), Some(t0 + SETTLE + EVERY));
    }

    #[test]
    fn a_change_after_a_quiet_spell_is_looked_at_soon() {
        let t0 = Instant::now();
        let mut t = throttle();
        t.changed(t0, false);
        t.fired(t0 + SETTLE);
        let later = t0 + Duration::from_secs(120);
        t.changed(later, false);
        assert_eq!(t.due(), Some(later + SETTLE));
    }

    /// Leaving a drawing (or the app) sends what was drawn at once.
    #[test]
    fn asked_for_now_it_is_due_now() {
        let t0 = Instant::now();
        let mut t = throttle();
        t.changed(t0, false);
        t.fired(t0 + SETTLE);
        let soon = t0 + Duration::from_secs(5);
        t.changed(soon, false);
        t.changed(soon, true);
        assert_eq!(t.due(), Some(soon));
    }
}
