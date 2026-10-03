# Solstice Sync

Design and decisions for syncing vaults between devices (desktop now, iOS
later) through a server on Jupiter. Direction lives in the Sunstead roadmap
(`Cosmos/docs/ROADMAP.md`, section 5); this is the how.

## Goals

- **Files stay the truth.** Notes are plain `.md` files on every device and
  on the server (`data/notes/<user>/<vault>/`), readable by any editor, git
  and Atlas. Sync state sits beside them and can be rebuilt.
- **Offline first.** Every device edits freely offline; edits merge when it
  reconnects, with nothing lost.
- **Merges are reviewable.** When two devices changed the same text, the merge
  is flagged and both versions stay recoverable.

## Decisions (2026-10-03)

| Decision | Choice |
|---|---|
| CRDT | **Yjs, via `yrs`** (Rust). Chosen over Automerge after the spike below. |
| Per note | One `Y.Doc` holding a `Y.Text` named `md` with the raw markdown. Merges happen on text, so the server writes files with no editor schema. |
| History | `skip_gc = true`, so earlier states can be read back from snapshots (cost: about 3% more state). Offsets are UTF-16 units, as in Yjs. |
| File edits | A save is diffed (character-level Myers, `similar`) against the text the editor loaded, and the changes are carried through history to today's text, so a save from a stale buffer never reverts edits that arrived since. |
| Overlapping offline edits | Merge as usual. If both sides changed overlapping text (by whole words) since their common base, flag the note and offer a review with each side's version. |
| Per vault | A manifest `Y.Doc`: a `Y.Map` with flat keys `<id>/path`, `<id>/kind`, `<id>/hash`, `<id>/deleted` per file (UUID ids), so concurrent changes to different fields merge. Renames and moves are CRDT operations; ids survive them and stay out of the files. Two files claiming one path (ignoring case) get ` 1`, ` 2` by id order, the same on every replica. |
| Attachments | Everything but `.md` (images, PDFs, canvases) is a content-addressed blob (SHA-256), last writer wins. When both sides replaced one, the losing version is kept beside it as `name (this device).ext` or `name (other device).ext`. |
| Deletes | Tombstones that record the note's state vector (or the blob's hash) at deletion. A replica that sees edits the deleter hadn't, restores the file; a restored note is flagged for review. |
| Lost server state | Each doc has an `epoch`. If the server rebuilds a note from its file, the epoch changes, and a device drops its old history for it: with no changes of its own it adopts the server's; if only it changed the note, it replays its text on the new history; if both did, it keeps its text as `name (this device).md`. Old histories never merge into a new one, which would duplicate text. A new manifest epoch means linking the vault again. |
| First link | Files on one side are copied over; files on both with different content are kept both ways (the server's keeps the name, this device's becomes `name (this device).ext`). |
| Scope | Notes and attachments. `.solstice/` (layout, tabs, settings, themes) stays per device. |

## Spike results

Throwaway code, run on 2026-10-03 against yrs 0.28 and automerge 0.12. Same
design for both: raw markdown in one CRDT text, file saves applied by diffing.

| | yrs | Automerge |
|---|---|---|
| Convergence: 300 random offline edit pairs (emoji, CJK, accents), synced, then reloaded from saved state | 0 failures | 0 failures |
| Time per save (diff + apply), 5.5 KB note | 0.20 ms | 0.23 ms |
| Load a note's state | 0.5 ms | 2.6 ms |
| Stored state after 1000 saves | 19.5 KB (3.5x text); 20.0 KB keeping history | 12 KB (2.2x text) |
| One save sent over a live connection | 15 B | 96 B |
| Reconnect after one edit | 1 round trip, 1.9 KB | 3 round trips, 4.3 KB |
| Text at an earlier point | Snapshots, with `skip_gc` | Built in (`text_at`, heads) |

**Merge quality depends on the diff, not the library.** Both gave identical
merges:

- Edits to different paragraphs, appends and most edits merge cleanly.
- Two devices changing the same word offline can garble it: "colour" changed
  to "color" on one side and to "hue" on the other merged to "The he is red."
- Deleting a line on one side while editing it on the other leaves the other
  side's insertion as a fragment.

A word-level diff fixed the first case and made others worse, so no diff
granularity removes this. What matters is noticing overlaps and keeping both
versions: from snapshots, yrs recovered exactly "The color is red." and "The
hue is red." after the bad merge above.

## Reviewing overlapping edits

Nothing about the last sync is stored. When a device's `Step2` brings in the
server's changes, it has everything it needs:

1. `local` is this device's snapshot just before applying; `remote` is the
   server's state vector (sent with its `Step2`) plus the delete set its
   update carries; `base` is what both had: per author the lower clock, and
   the deletions both made.
2. It reads all three texts from history and diffs base→local and
   base→remote. Each change is widened to whole words (two devices changing
   different letters of one word garble it just the same). The merge is
   flagged if changes overlap; two insertions at the same point count only
   mid-line, so both sides appending lines stays silent.
3. A flagged merge is recorded in the manifest's `reviews` map with the
   three snapshots, so it syncs: every device can show it, and resolving it
   anywhere clears it. The desktop app shows a banner offering each version.

Only the device doing the merge can see both sides (the other may have synced
and gone), so it also decides which attachment version lost a tie-break and
keeps that one as a copy.

## yrs 0.28 caveats

Found while building the engine, and worked around in `crates/solstice-sync`:

- `encode_state_from_snapshot` can produce bytes yrs can't decode when a
  snapshot ends inside a block yrs merged from several edits (common for a
  merge's base). Text is read with `Text::diff_range` from the live document
  instead, and stale saves are carried through the runs it reports rather
  than replayed in a copy of the past document.
- The same function panics when a snapshot counts edits held as pending
  (arrived before what they depend on). Snapshots are clamped to the
  integrated state before rebuilding the manifest at a point in history.

## Components

- `crates/solstice-core`: vault paths, wikilinks, front matter.
- `crates/solstice-sync`: the engine, with no I/O. `NoteDoc` (a note's text
  with history, saves, reading earlier text), `Manifest`, `Vault` (one
  replica and its local operations), `Session` (the protocol for one
  connection, device or server end), `overlaps`, `plan_link`, and `Frame`
  (`postcard`-encoded binary frames of y-sync step 1, step 2 and update
  messages per `(vault, doc)`). Tests run a server and devices in memory,
  on and offline, through randomized edits, renames, deletes and stale saves.
- `apps/sync`: the axum server (`ghcr.io/sunstead/solstice-sync`). Authentik
  JWTs for the apps, per-user API tokens for Atlas, rusqlite for state, files
  under `data/notes/<user>/<vault>/`, blobs over HTTP.
- The desktop sync client, in Rust inside `src-tauri`, driven by its own file
  watcher, so the editor doesn't change at first.

Later: binding the editor to the `Y.Text` for live co-editing, and the iOS app.
