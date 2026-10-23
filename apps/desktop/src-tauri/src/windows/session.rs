//! Which windows are open, what each shows, and where: the part of
//! `windows` that touches no window, so it can be tested.

use serde::{Deserialize, Serialize};
use specta::Type;

/// A full window has the explorer; an editor window is tabs torn off a full
/// window of the same workspace, and closes with it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum WindowKind {
    Full,
    Editor { parent: String },
}

/// A window's frame in logical pixels: outer position, inner size.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, Type)]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Bounds {
    pub fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.x && y >= self.y && x < self.x + self.width && y < self.y + self.height
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct WindowEntry {
    pub label: String,
    pub kind: WindowKind,
    pub workspace: Option<String>,
    pub bounds: Option<Bounds>,
}

/// Every window, in the order they opened. Saved as it changes, so a
/// relaunch reopens the same set.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Session {
    pub windows: Vec<WindowEntry>,
    /// Set once the app is on its way out: windows closing then are the app
    /// quitting, not the user putting one away.
    #[serde(skip)]
    pub quitting: bool,
}

impl Session {
    pub fn get(&self, label: &str) -> Option<&WindowEntry> {
        self.windows.iter().find(|w| w.label == label)
    }

    fn get_mut(&mut self, label: &str) -> Option<&mut WindowEntry> {
        self.windows.iter_mut().find(|w| w.label == label)
    }

    /// Adds a window, or replaces the entry of one with the same label.
    pub fn add(&mut self, entry: WindowEntry) {
        match self.get_mut(&entry.label) {
            Some(existing) => *existing = entry,
            None => self.windows.push(entry),
        }
    }

    pub fn set_workspace(&mut self, label: &str, workspace: Option<String>) {
        if let Some(w) = self.get_mut(label) {
            w.workspace = workspace;
        }
    }

    pub fn set_bounds(&mut self, label: &str, bounds: Bounds) {
        if let Some(w) = self.get_mut(label) {
            w.bounds = Some(bounds);
        }
    }

    /// The full window showing `workspace`, if one is: opening it again
    /// goes there instead of making another.
    pub fn full_window_for(&self, workspace: &str) -> Option<&str> {
        self.windows
            .iter()
            .find(|w| w.kind == WindowKind::Full && w.workspace.as_deref() == Some(workspace))
            .map(|w| w.label.as_str())
    }

    /// The editor windows torn off `parent`, which close with it.
    pub fn editors_of(&self, parent: &str) -> Vec<String> {
        self.windows
            .iter()
            .filter(|w| matches!(&w.kind, WindowKind::Editor { parent: p } if p == parent))
            .map(|w| w.label.clone())
            .collect()
    }

    /// The full window an editor window belongs to, or the window itself.
    pub fn owner<'a>(&'a self, label: &'a str) -> &'a str {
        match self.get(label).map(|w| &w.kind) {
            Some(WindowKind::Editor { parent }) => parent,
            _ => label,
        }
    }

    /// Whether `label` is the only full window: closing it quits the app.
    pub fn is_last_full(&self, label: &str) -> bool {
        self.get(label).is_some_and(|w| w.kind == WindowKind::Full)
            && !self.windows.iter().any(|w| w.label != label && w.kind == WindowKind::Full)
    }

    /// A window is closing. Closing the last full window quits the app, so
    /// it and everything after it stay, to come back on the next launch;
    /// any other window is forgotten. Returns whether it was forgotten.
    pub fn close(&mut self, label: &str) -> bool {
        if self.quitting || self.get(label).is_none() {
            return false;
        }
        if self.is_last_full(label) {
            self.quitting = true;
            return false;
        }
        self.windows.retain(|w| w.label != label);
        true
    }

    /// The windows to reopen at launch: editor windows whose full window
    /// is gone are dropped. Empty when there's nothing to restore.
    pub fn restorable(&self) -> Vec<WindowEntry> {
        self.windows
            .iter()
            .filter(|w| match &w.kind {
                WindowKind::Full => true,
                WindowKind::Editor { parent } => {
                    self.get(parent).is_some_and(|p| p.kind == WindowKind::Full)
                }
            })
            .cloned()
            .collect()
    }
}

/// The tab drag under way, if any: which window it left, and which drag it
/// is, so the OS seeing the button up and the page's `dragend` end it once.
#[derive(Debug, Default)]
pub struct DragSlot {
    current: Option<(String, u64)>,
    next: u64,
}

impl DragSlot {
    /// A drag starts from `source`, replacing any left over; returns its id.
    pub fn begin(&mut self, source: &str) -> u64 {
        self.next += 1;
        self.current = Some((source.to_string(), self.next));
        self.next
    }

    /// Ends drag `id`, if it's still the one under way; returns its source.
    pub fn end(&mut self, id: u64) -> Option<String> {
        match &self.current {
            Some((_, current)) if *current == id => self.current.take().map(|(s, _)| s),
            _ => None,
        }
    }

    /// Ends the drag `source` started, if it's still under way.
    pub fn end_from(&mut self, source: &str) -> Option<u64> {
        match &self.current {
            Some((s, id)) if s == source => {
                let id = *id;
                self.current = None;
                Some(id)
            }
            _ => None,
        }
    }

    pub fn is(&self, id: u64) -> bool {
        matches!(&self.current, Some((_, current)) if *current == id)
    }
}

/// The first frame under a point, in the order given (front-most first).
pub fn window_under(frames: &[(String, Bounds)], x: f64, y: f64) -> Option<&str> {
    frames.iter().find(|(_, b)| b.contains(x, y)).map(|(l, _)| l.as_str())
}

/// Where menu commands go: the window last focused, if it's still open,
/// else the first one open.
pub fn menu_target<'a>(last_focused: Option<&'a str>, open: &[&'a str]) -> Option<&'a str> {
    last_focused
        .filter(|l| open.contains(l))
        .or_else(|| open.first().copied())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn full(label: &str, ws: &str) -> WindowEntry {
        WindowEntry { label: label.into(), kind: WindowKind::Full, workspace: Some(ws.into()), bounds: None }
    }

    fn editor(label: &str, parent: &str, ws: &str) -> WindowEntry {
        WindowEntry {
            label: label.into(),
            kind: WindowKind::Editor { parent: parent.into() },
            workspace: Some(ws.into()),
            bounds: None,
        }
    }

    fn session(windows: Vec<WindowEntry>) -> Session {
        Session { windows, quitting: false }
    }

    #[test]
    fn finds_the_full_window_of_a_workspace() {
        let s = session(vec![full("main", "/a"), editor("w-1", "main", "/b"), full("w-2", "/b")]);
        assert_eq!(s.full_window_for("/a"), Some("main"));
        // An editor window of /b is not where /b opens.
        assert_eq!(s.full_window_for("/b"), Some("w-2"));
        assert_eq!(s.full_window_for("/c"), None);
    }

    #[test]
    fn lists_editor_windows_of_a_parent() {
        let s = session(vec![full("main", "/a"), editor("w-1", "main", "/a"), full("w-2", "/b"), editor("w-3", "main", "/a")]);
        assert_eq!(s.editors_of("main"), vec!["w-1", "w-3"]);
        assert!(s.editors_of("w-2").is_empty());
        assert_eq!(s.owner("w-3"), "main");
        assert_eq!(s.owner("w-2"), "w-2");
    }

    #[test]
    fn closing_a_window_forgets_it() {
        let mut s = session(vec![full("main", "/a"), full("w-2", "/b"), editor("w-3", "main", "/a")]);
        assert!(s.close("w-3"));
        assert!(s.close("w-2"));
        assert_eq!(s.windows, vec![full("main", "/a")]);
    }

    #[test]
    fn closing_the_last_full_window_keeps_everything_for_next_launch() {
        let mut s = session(vec![full("main", "/a"), editor("w-1", "main", "/a")]);
        assert!(!s.close("main"));
        // Its editor windows close after it, as the app quits.
        assert!(!s.close("w-1"));
        assert_eq!(s.windows.len(), 2);
    }

    #[test]
    fn quitting_keeps_every_window() {
        let mut s = session(vec![full("main", "/a"), full("w-2", "/b")]);
        s.quitting = true;
        assert!(!s.close("w-2"));
        assert_eq!(s.windows.len(), 2);
    }

    #[test]
    fn restores_only_editor_windows_with_their_full_window() {
        let s = session(vec![full("main", "/a"), editor("w-1", "main", "/a"), editor("w-2", "gone", "/a")]);
        let labels: Vec<_> = s.restorable().into_iter().map(|w| w.label).collect();
        assert_eq!(labels, vec!["main", "w-1"]);
    }

    #[test]
    fn finds_the_window_under_a_point() {
        let b = |x, y| Bounds { x, y, width: 100.0, height: 100.0 };
        let frames = vec![("w-2".to_string(), b(50.0, 50.0)), ("main".to_string(), b(0.0, 0.0))];
        assert_eq!(window_under(&frames, 60.0, 60.0), Some("w-2"));
        assert_eq!(window_under(&frames, 10.0, 10.0), Some("main"));
        assert_eq!(window_under(&frames, 500.0, 500.0), None);
    }

    #[test]
    fn a_drag_ends_once() {
        let mut slot = DragSlot::default();
        let id = slot.begin("main");
        assert!(slot.is(id));
        // The page's `dragend` first; then the button watch finds it over.
        assert_eq!(slot.end_from("main"), Some(id));
        assert_eq!(slot.end(id), None);
        // The other way round.
        let id = slot.begin("main");
        assert_eq!(slot.end(id), Some("main".into()));
        assert_eq!(slot.end_from("main"), None);
    }

    #[test]
    fn a_new_drag_replaces_an_old_one() {
        let mut slot = DragSlot::default();
        let old = slot.begin("main");
        let new = slot.begin("w-1");
        assert!(!slot.is(old));
        assert_eq!(slot.end(old), None);
        assert_eq!(slot.end_from("main"), None);
        assert_eq!(slot.end(new), Some("w-1".into()));
    }

    #[test]
    fn menu_goes_to_the_last_focused_window_still_open() {
        assert_eq!(menu_target(Some("w-2"), &["main", "w-2"]), Some("w-2"));
        assert_eq!(menu_target(Some("w-9"), &["main", "w-2"]), Some("main"));
        assert_eq!(menu_target(None, &["w-2"]), Some("w-2"));
        assert_eq!(menu_target(None, &[]), None);
    }

    #[test]
    fn round_trips_through_json() {
        let s = session(vec![full("main", "/a"), editor("w-1", "main", "/a")]);
        let json = serde_json::to_string(&s).unwrap();
        assert!(json.contains(r#""type":"editor","parent":"main""#), "{json}");
        let back: Session = serde_json::from_str(&json).unwrap();
        assert_eq!(back, s);
    }
}
