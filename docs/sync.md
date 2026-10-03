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
| History | `skip_gc = true`, so earlier states can be rebuilt from snapshots (cost: about 3% more state). |
| File edits | A save is diffed against the CRDT text (character-level Myers, `similar`) and applied as inserts and deletes. |
| Overlapping offline edits | Merge as usual. If both sides changed overlapping text since they last synced, flag the note and offer a review with each side's version. |
| Per vault | A manifest `Y.Doc`: a `Y.Map` from a stable note id (UUID) to `{path, kind}`. Renames and moves are CRDT operations; ids survive them and stay out of the files. |
| Attachments | Images, PDFs and canvases are content-addressed blobs, last writer wins, with a conflict copy when both sides changed one. |
| Lost server state | Each doc has an `epoch`. If the server rebuilds a doc from its file, the epoch changes; a client then drops its CRDT state for that doc and re-applies its unsynced edits as a text diff, so old histories never merge into a new one (which would duplicate text). |

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

Per doc, each side keeps the snapshot of the last state it and the server
agreed on (`synced`). When a merge brings in remote changes:

1. `local` = this side's snapshot just before applying; `remote` = the
   sender's state vector (from sync step 1) plus the delete set its update
   carries.
2. Rebuild `base`, `local` and `remote` texts from the snapshots, diff
   base→local and base→remote, and flag the merge if a changed range on one
   side overlaps a changed range on the other. Two insertions at the same
   point count only when not at a line start, so both sides appending lines
   stays silent.
3. A flagged merge is recorded with the three snapshots. The desktop app
   shows a banner on the note offering each version, to pick one or edit the
   merged text, which is just another edit.

## Components

- `crates/solstice-core`: vault paths, wikilinks, front matter (done).
- `crates/solstice-sync`: the doc store, file to CRDT diffing, the manifest,
  snapshots and overlap detection, and the wire protocol (y-sync step 1,
  step 2 and update messages, multiplexed by `(vault, doc)` over one
  WebSocket; blobs over HTTP).
- `apps/sync`: the axum server (`ghcr.io/sunstead/solstice-sync`). Authentik
  JWTs for the apps, per-user API tokens for Atlas, rusqlite for state, files
  under `data/notes/<user>/<vault>/`.
- The desktop sync client, in Rust inside `src-tauri`, driven by the existing
  file watcher, so the editor doesn't change at first.

Later: binding the editor to the `Y.Text` for live co-editing, and the iOS app.
