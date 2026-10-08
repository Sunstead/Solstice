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
- `apps/sync`: the server (`ghcr.io/sunstead/solstice-sync`, released with
  `sync-v*` tags). Details below.
- `crates/solstice-sync-fs`: a synced vault's folder, shared by server and
  devices. Scanning (hashes cached by size and mtime), writing through a
  temp file, attachments by hash, deletes to a private `trash/`, and turning
  disk edits into vault operations.
- `crates/solstice-sync-client`: a device's side (details below); the
  desktop app wraps it in `src-tauri/src/sync/`.

Later: binding the editor to the `Y.Text` for live co-editing, and the iOS app.

## The server (`apps/sync`)

**Storage.** A vault is a folder, `<notes dir>/<username>/<vault name>/`,
holding the notes and attachments as plain files, plus each document's Yjs
state in `sync.db` (users, API tokens, vaults, documents) in the state dir.
`.solstice/` inside a vault folder is the server's: `blobs/` caches
attachments by hash, `trash/` keeps files deleted through sync.

**One task per vault in use** owns its documents, folder and connected
devices. Device frames go through a server-side `Session` per connection;
updates go on to the vault's other devices. Changes are written to the
folder at once and the state saved about two seconds later. Files first:
after a crash the folder is never behind the database, so the folder wins at
startup, and state lost in those seconds heals itself because devices keep
full history and resend what the server lacks. A task stops after ten idle
minutes, and saves on shutdown.

**The folder is live.** A watcher turns edits made there (by hand, a script)
into changes for devices: edits, new files, renames (a vanished file and a
new one with the same content) and deletes. At startup each vault is
reconciled with its folder, and notes whose state was lost are rebuilt from
their files under a new epoch. Folders in a user's notes dir that aren't
vaults yet (made by hand, or the database was lost) become vaults when the
user lists them, under new ids; a device with an old id is told
`unknown_vault` and links again.

**Deleting a vault** (`DELETE /v1/vaults/{id}`, the web app's Delete) stops
its task without saving, tells every connected device and web app
`vault_deleted`, forgets its state, and moves its folder to the user's
hidden `.trash` (`<notes>/<user>/.trash/<name> <UTC time>`), which listing
and Atlas skip and from which an admin can recover it. A device that
connects later hears the same notice. Devices stop syncing that folder
(status `deleted`) and keep their files.

**Auth.** Apps present an Authentik access token, checked offline against
the provider's keys (the verifier is Cosmos's), always as `Authorization:
Bearer`, the WebSocket included: tokens never go in URLs. The username
(`preferred_username`, never a display name) names the user's folder, so it
must be one safe path segment, and belongs to one identity. API tokens
(`sst_...`, stored as SHA-256) can only list vaults and create notes, for
Atlas. `SOLSTICE_DEV_USER` signs everyone in as one user, for development.

**The web app** signs in with a session instead (`auth/web.rs`, ported from
Atlas). The server runs the authorization code flow with PKCE and a nonce,
on the same public `solstice` client as the apps (so a browser and a device
are the same user), checks the ID token by the same rules, and keeps none of
the provider's tokens: the browser gets a `__Host-solstice_session` cookie
(HttpOnly, `SameSite=Lax`, 30 days sliding; only its hash is stored). It
needs `SOLSTICE_PUBLIC_URL` for the redirect URI. The web routes
(`web_api.rs`) run in the vault's task (`hub/web.rs`) through the engine, so
devices get web changes as ordinary sync:
- A note is read with its text and a `base` (its snapshot, opaque), and saved
  with both: `NoteDoc::apply_save` carries the edit onto whatever arrived
  since, so a stale editor never reverts another device's edit. A base from
  another epoch, or naming changes the server hasn't seen, is refused (409);
  the app keeps its text beside the note as `name (web).md` and reloads.
- The app journals each save in IndexedDB before sending it, so a lost
  signal or a closed page loses nothing, and sends a note's saves one at a
  time. A save carries a `save_id`, and the vault's task applies an id once
  (it remembers the last few hundred): a save whose reply was lost is sent
  again as it was, before anything newer, which would otherwise carry its
  edit a second time.
- Web saves never flag reviews, like a desktop editor's saves; the web app
  shows and resolves reviews devices flagged.
- Folders aren't in the manifest, so an empty one made on the web exists
  only on the server's disk until it holds a file.
- Settings that follow the user between browsers are kept per user in
  `sync.db`; devices keep theirs in each vault's `.solstice/`.

**Security.**
- A sync WebSocket lasts as long as the access token it was opened with
  (Authentik's are short-lived): the server sends `token_expired` and
  closes, and the device reconnects with a fresh token, so leaving the
  allowed groups takes effect within one token's life.
- Any peer can write the manifest, so its paths are checked wherever they
  are read: entries whose path isn't a plain, visible vault path (no `..`,
  nothing absolute or hidden) are ignored by every replica alike. Blob
  hashes must be 64 hex digits before they name a file, and devices check
  downloaded attachments against their hash.
- Devices refuse plain `http://` servers except on the same machine.
- API tokens don't expire. A user deletes their own; they can only create
  notes, never read them.
- Cookie-authenticated changes need `X-Solstice-Request: 1` and the
  server's own `Origin`; the events WebSocket checks the `Origin` too. A
  session can't use device sync, blobs or API tokens.
- A vault file is served with `nosniff` and, except PDFs, `CSP: sandbox`;
  anything that isn't an image, media, text or PDF downloads. The web app's
  shell gets a strict policy (scripts from the server only, plus the
  first-paint script by hash).
- A web session's groups are checked at sign-in only; signing out on any
  page ends it, and the events socket notices within a minute.

**API.**

| Route | Who | |
|---|---|---|
| `GET /`, `GET /healthz`, `GET /v1/info` | anyone | Info says how to sign in, and the protocol version. |
| `GET /v1/vaults` | apps, tokens | The user's vaults. |
| `POST /v1/vaults` `{name}` | apps, web | A vault is a folder name. |
| `DELETE /v1/vaults/{id}` | apps, web | Moves the vault to the user's `.trash` on the server; devices are told `vault_deleted`. |
| `POST /v1/vaults/{id}/notes` `{path, text}` | apps, tokens | Returns `{id, path}`; a taken path gets the next number. |
| `PUT`/`GET /v1/vaults/{id}/blobs/{sha256}` | apps | Attachment bytes; upload before the manifest names them. |
| `GET`/`POST /v1/tokens`, `DELETE /v1/tokens/{id}` | apps | API tokens; the token is shown once. |
| `GET /v1/sync` | apps | The WebSocket: binary `Frame`s both ways; JSON text notices (`unknown_vault`, `vault_deleted`, `token_expired`, `bad_frame`). |
| `GET /auth/login?return_to=`, `GET /auth/callback`, `POST /auth/logout` | browsers | Web sign-in and out. |
| `GET /v1/me` | apps, web | Who's signed in. |
| `GET /v1/vaults/{id}/tree` | apps, web | `{files: [{path, kind, size, modified}], folders}`. |
| `GET`/`PUT /v1/vaults/{id}/notes/{*path}` | apps, web | `{path, text, base}`; a save sends `{text, base, save_id?}` and gets the merged note back. |
| `GET`/`PUT /v1/vaults/{id}/files/{*path}` | apps, web | Any file's bytes; a PUT writes a file that isn't a note (`?new=1`: under a free name). |
| `POST /v1/vaults/{id}/ops` | apps, web | `{op: create_note | create_folder | rename | trash | duplicate, ...}`. |
| `GET /v1/vaults/{id}/reviews`, `GET`/`POST .../reviews/{*path}` | apps, web | Flagged merges, their versions, and resolving one (`{text?}`). |
| `GET /v1/web/events?vault=` | apps, web | WebSocket: `{"tree": bool, "notes": [path]}` per change. |
| `GET`/`PUT /v1/web/settings/{scope}` | apps, web | A JSON object per scope (`global`, `vault.<id>`). |

**Config.** `SOLSTICE_BIND` (default `0.0.0.0:8080`), `SOLSTICE_NOTES_DIR`,
`SOLSTICE_STATE_DIR`, `SOLSTICE_OIDC_ISSUER`, `SOLSTICE_OIDC_CLIENT_ID`
(default `solstice`), `SOLSTICE_OIDC_SCOPES`, `SOLSTICE_OIDC_ALLOWED_GROUPS`,
`SOLSTICE_OIDC_DISCOVERY_URL`, `SOLSTICE_DEV_USER`, `SOLSTICE_PUBLIC_URL`
(web sign-in), `SOLSTICE_WEB_DIR` (the web app's build, served at `/`;
without it `/` says the server is running). The server holds no secrets:
the OIDC client is public.

## Devices (`crates/solstice-sync-client`)

**Linking** (`link`) downloads the vault, compares it with the folder
(`plan_link`: same files link, one-sided files copy over, differing files are
kept both ways), applies that, uploads, and saves the link and state in
`<folder>/.solstice/sync/state.db`. `unlink` removes the sync state; the files
stay.

**A running client** (`Client`) is one task per linked folder. Offline, edits
keep landing in its documents and folder; online, it holds one WebSocket,
reconnecting with backoff, and reports `connecting`, `syncing`, `synced`,
`offline`, `signed_out`, `relink` or `deleted` (the vault was deleted on the
server: it stops for good, keeping the folder's files). Attachments upload before the manifest
names them and download in the background. Where each file was last written
is saved with the state, so a restart can tell a deleted file from one that
never arrived.

**Editor saves.** The client keeps, for each note an editor has open, a copy
of its document that mirrors exactly what the editor holds
(`editor_opened`, refreshed whenever the editor loads or reloads it). A save
(`saved`) is diffed against that copy, which is precisely the user's change,
and merged into the real note as a concurrent edit. So a buffer that never
reloaded can't revert changes that arrived meanwhile, even over several
saves. Writes by anything else are read from the folder like outside edits.

**Desktop.** `src-tauri/src/sync/` signs in (Cosmos's PKCE loopback flow; the
refresh token in the OS keychain under `net.sunstead.solstice`, never in the
webview), starts a client for each linked workspace a window has open, routes
`write_file` saves to it, and exposes `sync_*` commands and a `SyncChanged`
event to the frontend.

