//! A server and devices exchanging real protocol messages in memory, going
//! on and offline. Every scenario ends with all replicas agreeing on every
//! file.

use std::collections::BTreeMap;

use rand::rngs::SmallRng;
use rand::{Rng, SeedableRng};
use solstice_sync::{
    decode_snapshot, Content, DocKey, Event, Kind, Msg, ReviewKind, Session, Snapshot, Vault,
};

struct Device {
    vault: Vault,
    session: Session,
    online: bool,
    /// What each open editor loaded, for saves from stale buffers.
    editor: BTreeMap<String, Snapshot>,
}

struct Net {
    server: Vault,
    links: Vec<Session>,
    devices: Vec<Device>,
    to_server: Vec<(usize, Msg)>,
    to_device: Vec<(usize, Msg)>,
}

impl Net {
    fn new(devices: usize) -> Self {
        let mut net = Net {
            server: Vault::new("server"),
            links: (0..devices).map(|_| Session::server()).collect(),
            devices: (0..devices)
                .map(|i| Device {
                    vault: Vault::new(format!("device {i}")),
                    session: Session::device(),
                    online: false,
                    editor: BTreeMap::new(),
                })
                .collect(),
            to_server: vec![],
            to_device: vec![],
        };
        for i in 0..devices {
            net.connect(i);
        }
        net.pump();
        net
    }

    fn connect(&mut self, i: usize) {
        if self.devices[i].online {
            return;
        }
        self.devices[i].online = true;
        self.links[i] = Session::server();
        let msgs = self.devices[i].session.open(&self.devices[i].vault);
        self.to_server.extend(msgs.into_iter().map(|m| (i, m)));
    }

    fn disconnect(&mut self, i: usize) {
        self.devices[i].online = false;
        self.to_server.retain(|(d, _)| *d != i);
        self.to_device.retain(|(d, _)| *d != i);
    }

    /// A local change on device `i`: pushed live if online, otherwise it
    /// waits in the document for the next connect.
    fn send(&mut self, i: usize, msgs: Vec<Msg>) {
        if self.devices[i].online {
            self.to_server.extend(msgs.into_iter().map(|m| (i, m)));
        }
    }

    /// A change made on the server itself (a file edited on its disk).
    fn server_change(&mut self, msgs: Vec<Msg>) {
        for msg in msgs {
            for (i, d) in self.devices.iter().enumerate() {
                if d.online {
                    self.to_device.push((i, msg.clone()));
                }
            }
        }
    }

    fn pump(&mut self) -> Vec<(usize, Event)> {
        let mut events = vec![];
        for _ in 0..10_000 {
            if let Some((i, msg)) = (!self.to_server.is_empty()).then(|| self.to_server.remove(0)) {
                let out = self.links[i]
                    .receive(&mut self.server, msg)
                    .expect("server receive");
                self.to_device
                    .extend(out.replies.into_iter().map(|m| (i, m)));
                for event in out.events {
                    if let Event::Forward(m) = event {
                        for (j, d) in self.devices.iter().enumerate() {
                            if j != i && d.online {
                                self.to_device.push((j, m.clone()));
                            }
                        }
                    }
                }
            } else if let Some((i, msg)) =
                (!self.to_device.is_empty()).then(|| self.to_device.remove(0))
            {
                let d = &mut self.devices[i];
                let what = format!(
                    "{:?} epoch {} {}",
                    msg.doc,
                    msg.epoch,
                    match &msg.body {
                        solstice_sync::Body::Step1 { .. } => "Step1",
                        solstice_sync::Body::Step2 { sv: Some(_), .. } => "Step2+sv",
                        solstice_sync::Body::Step2 { .. } => "Step2",
                        solstice_sync::Body::Update { .. } => "Update",
                    }
                );
                let out = d
                    .session
                    .receive(&mut d.vault, msg)
                    .unwrap_or_else(|e| panic!("device {i} receive {what}: {e}"));
                events.extend(out.events.into_iter().map(|e| (i, e)));
                self.to_server
                    .extend(out.replies.into_iter().map(|m| (i, m)));
            } else {
                return events;
            }
        }
        panic!("the network never went quiet");
    }

    fn sync_all(&mut self) -> Vec<(usize, Event)> {
        let mut events = vec![];
        for i in 0..self.devices.len() {
            self.connect(i);
            events.extend(self.pump());
        }
        // Reconnecting everyone once more settles anything the first round
        // produced (restores, conflict copies).
        for i in 0..self.devices.len() {
            self.disconnect(i);
            self.connect(i);
            events.extend(self.pump());
        }
        events
    }

    fn assert_converged(&self) {
        let expected = self.server.files();
        for (i, d) in self.devices.iter().enumerate() {
            assert_eq!(
                d.vault.files(),
                expected,
                "device {i} differs from the server"
            );
        }
    }

    fn text(&self, i: usize, path: &str) -> String {
        match self.devices[i].vault.files().get(path) {
            Some((_, Content::Note(text))) => text.clone(),
            other => panic!("no note at {path}: {other:?}"),
        }
    }

    fn id(&self, path: &str) -> String {
        self.server
            .id_at(path)
            .unwrap_or_else(|| panic!("no file at {path}"))
    }
}

// ---------------------------------------------------------------- random

const ALPHABET: &[&str] = &[
    "a", "e", " ", "the ", "\n", "- ", "# ", "[[", "]]", "é", "日本", "🙂", "**",
];
const PATHS: &[&str] = &[
    "Inbox.md",
    "inbox.md",
    "notes/Plan.md",
    "notes/Ideas.md",
    "Untitled.md",
    "img/a.png",
];

fn random_edit(rng: &mut SmallRng, text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let n = chars.len();
    let at = rng.random_range(0..=n);
    let mut out = chars.clone();
    if n > 0 && rng.random_bool(0.35) {
        let end = (at + rng.random_range(1..12)).min(n);
        out.drain(at.min(n)..end);
    } else {
        let mut s = String::new();
        for _ in 0..rng.random_range(1..5) {
            s.push_str(ALPHABET[rng.random_range(0..ALPHABET.len())]);
        }
        out.splice(at..at, s.chars());
    }
    out.into_iter().collect()
}

fn random_step(net: &mut Net, rng: &mut SmallRng) {
    let i = rng.random_range(0..net.devices.len());
    let files = net.devices[i].vault.files();
    let pick = |rng: &mut SmallRng| {
        files
            .values()
            .nth(rng.random_range(0..files.len().max(1)))
            .cloned()
    };
    let msgs = match rng.random_range(0..100) {
        0..=9 => {
            if net.devices[i].online {
                net.disconnect(i);
            } else {
                net.connect(i);
            }
            vec![]
        }
        10..=19 => {
            let path = PATHS[rng.random_range(0..PATHS.len())];
            let d = &mut net.devices[i];
            if Kind::for_path(path) == Kind::Note {
                d.vault.create_note(path, "first line\n").unwrap().1
            } else {
                d.vault
                    .create_blob(path, &format!("hash{}", rng.random_range(0..3)))
                    .unwrap()
                    .1
            }
        }
        20..=69 => match pick(rng) {
            Some((id, Content::Note(text))) => {
                let d = &mut net.devices[i];
                // Sometimes the save comes from an editor that loaded the
                // note a while ago.
                match d.editor.get(&id).filter(|_| rng.random_bool(0.4)).cloned() {
                    Some(base) => {
                        let old = d.vault.note(&id).unwrap().text_at(&base).unwrap();
                        let new = random_edit(rng, &old);
                        d.vault.save_note(&id, &new, Some(&base)).unwrap()
                    }
                    None => {
                        let new = random_edit(rng, &text);
                        d.editor
                            .insert(id.clone(), d.vault.note(&id).unwrap().snapshot());
                        d.vault.save_note(&id, &new, None).unwrap()
                    }
                }
            }
            Some((id, Content::Blob(_))) => net.devices[i]
                .vault
                .set_blob(&id, &format!("hash{}", rng.random_range(0..3))),
            None => vec![],
        },
        70..=79 => match pick(rng) {
            Some((id, _)) => net.devices[i]
                .vault
                .rename(&id, PATHS[rng.random_range(0..PATHS.len())])
                .unwrap(),
            None => vec![],
        },
        80..=84 => match pick(rng) {
            Some((id, _)) => net.devices[i].vault.delete(&id),
            None => vec![],
        },
        _ => {
            net.pump();
            vec![]
        }
    };
    net.send(i, msgs);
}

#[test]
fn random_sessions_converge() {
    for seed in 0..150 {
        let mut rng = SmallRng::seed_from_u64(seed);
        let mut net = Net::new(3);
        for _ in 0..rng.random_range(10..60) {
            random_step(&mut net, &mut rng);
        }
        net.sync_all();
        let files = net.server.files();
        for (i, d) in net.devices.iter().enumerate() {
            assert_eq!(
                d.vault.files(),
                files,
                "seed {seed}: device {i} differs from the server"
            );
        }
    }
}

// ---------------------------------------------------------------- scenarios

fn offline_pair(text: &str) -> (Net, String) {
    let mut net = Net::new(2);
    let (id, msgs) = net.devices[0].vault.create_note("Colour.md", text).unwrap();
    net.send(0, msgs);
    net.pump();
    net.assert_converged();
    net.disconnect(0);
    net.disconnect(1);
    (net, id)
}

#[test]
fn overlapping_offline_edits_are_flagged_with_both_versions() {
    let (mut net, id) = offline_pair("The colour is red.\n");
    let a = net.devices[0]
        .vault
        .save_note(&id, "The color is red.\n", None)
        .unwrap();
    let b = net.devices[1]
        .vault
        .save_note(&id, "The hue is red.\n", None)
        .unwrap();
    net.send(0, a);
    net.send(1, b);
    let events = net.sync_all();
    net.assert_converged();

    assert!(
        events.contains(&(1, Event::Review(id.clone()))),
        "the second to reconnect notices"
    );
    let review = net
        .server
        .manifest
        .reviews()
        .remove(&id)
        .expect("the review syncs to the server");
    assert_eq!(review.kind, ReviewKind::Overlap);
    let note = net.devices[0].vault.note(&id).unwrap();
    let at = |s: &Option<Vec<u8>>| {
        note.text_at(&decode_snapshot(s.as_ref().unwrap()).unwrap())
            .unwrap()
    };
    assert_eq!(at(&review.base), "The colour is red.\n");
    assert_eq!(at(&review.local), "The hue is red.\n");
    assert_eq!(at(&review.remote), "The color is red.\n");

    // Resolving it anywhere clears it everywhere.
    let msgs = net.devices[0].vault.resolve_review(&id);
    net.send(0, msgs);
    net.pump();
    assert!(net.devices[1].vault.manifest.reviews().is_empty());
}

#[test]
fn clean_offline_merges_stay_silent() {
    let (mut net, id) = offline_pair("Alpha.\n\nBeta.\n\nGamma.\n");
    let a = net.devices[0]
        .vault
        .save_note(&id, "Alpha, by A.\n\nBeta.\n\nGamma.\n", None)
        .unwrap();
    let b = net.devices[1]
        .vault
        .save_note(&id, "Alpha.\n\nBeta.\n\nGamma, by B.\n", None)
        .unwrap();
    net.send(0, a);
    net.send(1, b);
    let events = net.sync_all();
    net.assert_converged();
    assert_eq!(
        net.text(0, "Colour.md"),
        "Alpha, by A.\n\nBeta.\n\nGamma, by B.\n"
    );
    assert!(!events.iter().any(|(_, e)| matches!(e, Event::Review(_))));
    assert!(net.server.manifest.reviews().is_empty());
}

#[test]
fn live_edits_reach_the_other_device() {
    let mut net = Net::new(2);
    let (id, msgs) = net.devices[0]
        .vault
        .create_note("Live.md", "one\n")
        .unwrap();
    net.send(0, msgs);
    net.pump();
    let msgs = net.devices[0]
        .vault
        .save_note(&id, "one\ntwo\n", None)
        .unwrap();
    net.send(0, msgs);
    let events = net.pump();
    assert!(events.contains(&(1, Event::Changed(DocKey::Note(id)))));
    assert_eq!(net.text(1, "Live.md"), "one\ntwo\n");
}

#[test]
fn a_stale_editor_save_keeps_the_other_devices_edit() {
    let mut net = Net::new(2);
    let (id, msgs) = net.devices[0]
        .vault
        .create_note("Doc.md", "one\ntwo\n")
        .unwrap();
    net.send(0, msgs);
    net.pump();
    // Device 0's editor loads the note...
    let base = net.devices[0].vault.note(&id).unwrap().snapshot();
    // ...device 1 adds a line, which reaches device 0's file...
    let msgs = net.devices[1]
        .vault
        .save_note(&id, "one\ntwo\nthree from 1\n", None)
        .unwrap();
    net.send(1, msgs);
    net.pump();
    // ...and device 0's buffer, which never reloaded, is saved.
    let msgs = net.devices[0]
        .vault
        .save_note(&id, "ONE\ntwo\n", Some(&base))
        .unwrap();
    net.send(0, msgs);
    net.pump();
    net.assert_converged();
    assert_eq!(net.text(1, "Doc.md"), "ONE\ntwo\nthree from 1\n");
}

#[test]
fn notes_made_offline_with_one_name_get_numbered_alike() {
    let mut net = Net::new(2);
    net.disconnect(0);
    net.disconnect(1);
    net.devices[0]
        .vault
        .create_note("Untitled.md", "from 0")
        .unwrap();
    net.devices[1]
        .vault
        .create_note("untitled.md", "from 1")
        .unwrap();
    net.sync_all();
    net.assert_converged();
    let mut paths: Vec<String> = net
        .server
        .files()
        .into_keys()
        .map(|p| p.to_lowercase())
        .collect();
    paths.sort();
    assert_eq!(paths, ["untitled 1.md", "untitled.md"]);
}

#[test]
fn an_edit_brings_back_a_note_deleted_elsewhere() {
    let (mut net, id) = offline_pair("keep me\n");
    let a = net.devices[0].vault.delete(&id);
    let b = net.devices[1]
        .vault
        .save_note(&id, "keep me, edited\n", None)
        .unwrap();
    net.send(0, a);
    net.send(1, b);
    net.sync_all();
    net.assert_converged();
    assert_eq!(net.text(0, "Colour.md"), "keep me, edited\n");
    assert_eq!(
        net.server.manifest.reviews()[&id].kind,
        ReviewKind::Restored
    );
}

#[test]
fn a_delete_without_competing_edits_sticks() {
    let (mut net, id) = offline_pair("bye\n");
    let a = net.devices[0].vault.delete(&id);
    net.send(0, a);
    net.sync_all();
    net.assert_converged();
    assert!(net.server.files().is_empty());
}

#[test]
fn an_attachment_replaced_on_both_sides_is_kept_both_ways() {
    let mut net = Net::new(2);
    let (id, msgs) = net.devices[0]
        .vault
        .create_blob("img/a.png", "original")
        .unwrap();
    net.send(0, msgs);
    net.pump();
    net.disconnect(0);
    net.disconnect(1);
    net.devices[0].vault.set_blob(&id, "from-0");
    net.devices[1].vault.set_blob(&id, "from-1");
    net.sync_all();
    net.assert_converged();
    let mut hashes: Vec<String> = net
        .server
        .files()
        .into_values()
        .filter_map(|(_, c)| match c {
            Content::Blob(h) => Some(h),
            _ => None,
        })
        .collect();
    hashes.sort();
    assert_eq!(hashes, ["from-0", "from-1"]);
    // The copy is named for whose version lost the tie-break.
    assert!(net
        .server
        .files()
        .keys()
        .any(|p| p == "img/a (this device).png" || p == "img/a (other device).png"));
}

#[test]
fn a_rebuilt_note_never_duplicates_text() {
    // Unchanged on the device: it adopts the server's rebuilt copy.
    let (mut net, id) = offline_pair("line one\nline two\n");
    let msgs = net.server.rebuild_note(&id, "line one\nline two\n");
    net.server_change(msgs);
    net.sync_all();
    net.assert_converged();
    assert_eq!(net.text(0, "Colour.md"), "line one\nline two\n");

    // Changed only on the device: its edit is replayed on the new history.
    let msgs = net.devices[0]
        .vault
        .save_note(&id, "line one\nline two\nmine\n", None)
        .unwrap();
    net.disconnect(0);
    drop(msgs);
    let msgs = net.server.rebuild_note(&id, "line one\nline two\n");
    net.server_change(msgs);
    net.sync_all();
    net.assert_converged();
    assert_eq!(net.text(1, "Colour.md"), "line one\nline two\nmine\n");

    // Changed on both: the device's version is kept beside the server's.
    net.disconnect(0);
    net.devices[0]
        .vault
        .save_note(&id, "line one\nline two\nmine\nmore of mine\n", None)
        .unwrap();
    let msgs = net.server.rebuild_note(&id, "server's own rewrite\n");
    net.server_change(msgs);
    net.sync_all();
    net.assert_converged();
    assert_eq!(net.text(1, "Colour.md"), "server's own rewrite\n");
    assert_eq!(
        net.text(1, "Colour (this device).md"),
        "line one\nline two\nmine\nmore of mine\n"
    );
    let _ = net.id("Colour.md");
}
