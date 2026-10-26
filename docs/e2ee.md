# Encrypted vaults (design and spike plan)

Status: proposal, nothing built. Companion to `docs/sync.md`.

A vault can be **plain** (today: the server holds the notes as files and merges
them) or **encrypted** (the server holds only ciphertext it can't read). The
mode is chosen when the vault is created and never changes; moving a vault
between modes means making a new one and linking a folder to it.

Why per vault: the server's unit of everything is the vault (a `vaults` row,
one hub task, one folder, one manifest), users never share vaults, so there is
no group key management, and a self-hoster can keep plain vaults (search, web
app, Atlas) while a friend on the same server keeps private ones. A hosted
service would offer encrypted vaults only.

## What the server can't do in an encrypted vault

| Today | Encrypted vault |
|---|---|
| Notes as `.md` files in `<notes>/<user>/<vault>/`, edited by hand, git, Atlas | Opaque blobs under the state dir. No folder, no watcher, no reconcile. |
| Merge in the server's `Session` (y-sync step 1/2 by state vector) | A relay: an append-only log of encrypted updates (below). |
| Web app reads and saves (`web_api.rs`, `hub/web.rs`) | Not in the spike. Later: `solstice-sync` as WASM, keys in the browser. |
| `GET /v1/vaults/{id}/search` | Refused. Devices search their own folder. |
| API-token `create_note` (Atlas) | Refused: the server can't encrypt for anyone. |
| Epochs and rebuild-from-files | Epoch stays 0. Lost server state heals by any device re-uploading its full state. |

Unchanged: OIDC decides who may store and fetch (the key decides who may
read), `vault_deleted` and `token_expired` notices, vault colors, the
device-side merge logic, reviews (they live in the encrypted manifest).

## What the server still sees

Vault name and color, a user's vault count, entry sizes and timestamps, and
connection times. Not: file names or tree, note text, bookmarks, folder
colors, reviews, how many notes there are. Doc ids and paths sit inside
encrypted entries. A malicious server can withhold or roll back the log's
tail, but can't forge or reorder entries undetected (below). The local
folder and `.solstice/sync/state.db` on each device stay plaintext, as for any
notes app; disk encryption covers them.

## Keys

- **Vault key** `K`: 32 random bytes, made on the creating device. Subkeys by
  HKDF-SHA256 with distinct labels: `update`, `blob`, `blob-name`.
- **Recovery key**: a generated high-entropy secret (about 160 bits, shown as
  words or a code, once, at creation). `K` is wrapped under it and the wrap is
  stored on the server (`vaults.key_wrap`), so a new device with the recovery
  key can fetch it. Not a user-chosen passphrase: the server holds the wrap, so
  a weak passphrase could be guessed offline by whoever runs it. (A passphrase
  option, with a strength meter and that warning, can come later.)
- A device keeps `K` in the OS keychain beside the refresh token
  (`net.sunstead.solstice`), keyed by vault id. A second device can also get it
  by QR from the first, which never touches the server.
- Losing every device and the recovery key loses the vault. Say so at creation.

## The relay protocol

A separate route, `GET /v1/relay` (WebSocket), so the plain `Session` is
untouched and `PROTOCOL` stays 1. The server never decodes an entry.

- Client to server: `Hello { vault, after }` (the last sequence number it has),
  then `Push { entries: [Entry] }`.
- Server to client: `Entry { seq, bytes }` for everything after `after`, then
  live as others push; `Ack { upto }` for the client's own pushes.
- `Entry.bytes` is XChaCha20-Poly1305 (RustCrypto, 24-byte random nonce) over
  postcard `{ doc: DocKey, epoch: 0, update: Vec<u8> }`. The authenticated data
  is `vault_id || b"update"`, so an entry can't be moved to another vault or
  passed off as a blob.
- Yjs updates are idempotent and commutative, so no state vectors cross the
  wire and a duplicate or reordered entry is harmless.

**A device's outbox is a state vector.** Per doc it stores `pushed_sv`, the
state vector it last had acknowledged. On connect it pushes
`encode_diff(doc, pushed_sv)` for every doc that has moved on, so offline edits
need no queue and a crash can only resend. `Vault`'s local operations already
return `Msg`s; in relay mode those are pushed live and `pushed_sv` advances on
`Ack`.

**Reviews keep working.** `Session::merge_note` flags an overlap from the
server's state vector in `Step2`. In relay mode the device keeps, per doc, a
`relay_sv`: its `pushed_sv` merged with the state vector of every entry it has
pulled (likely `Update::state_vector`; to confirm). Pulls on connect are fed to
the existing device `Session` as `Step2 { update, sv: Some(relay_sv) }`, so
the overlap check and the recorded `base`/`local`/`remote` snapshots are the
code that already exists. Live entries go in as `Update`, which never flags,
as today.

**Compaction** (not in the spike): the log grows with every save. A client
uploads `Snapshot { upto, bytes }` (all docs' states, encrypted), valid only
for the `seq` it had applied; the server drops entries up to `upto`. Needed
before real use; the spike lets the log grow.

**Tampering** (not in the spike): each entry's authenticated data can later
carry the previous entry's hash, so a server that drops or reorders entries
breaks the chain on any device that remembers the last hash it saw.

## Attachments

Today a blob is stored by the SHA-256 of its bytes, and `Manifest` records
that hash. Keep that: the manifest is encrypted, so the plaintext hash is
hidden, and `solstice-sync-fs` (which hashes on every scan) is untouched. What
changes is where the server files it: under `HMAC-SHA256(blob-name key,
sha256)`, 64 hex digits so the server's existing hash-shape check passes.
Content is sealed with a random nonce, authenticated data `vault_id ||
b"blob"`. A device still checks a download against the manifest's hash after
decrypting. Equal files in one vault still share a blob; the server can't tell
what they are, or whether another vault has them.

## Server changes

- Migration 0.4: `vaults.mode TEXT NOT NULL DEFAULT 'plain'`,
  `vaults.key_wrap BLOB`; table `relay_log (vault_id, seq, bytes)`.
- `POST /v1/vaults` takes `{name, mode, key_wrap}`; `GET /v1/vaults` returns
  them. Old clients see `mode` as an unknown field and an encrypted vault as
  linkable, so listing hides encrypted vaults from clients that don't send a
  capability header.
- A vault task for an encrypted vault is a log with subscribers: no `Vault`,
  no `VaultDir`, no watcher. Blobs live under the state dir, not the notes dir.
- `web_api.rs`, search and API-token note creation answer 409 `encrypted`.

## Client changes

- New crate `solstice-sync-crypto`: key generation, HKDF, seal/open, the
  recovery key's encoding, the blob-name HMAC. No I/O; tests only.
- `solstice-sync-client`: `Link` gains `mode`. `Client` connects with a relay
  transport instead of the `Session::open` handshake. `store.rs` gains
  `relay (last_seq)` and `pushed (doc, sv)`. `link()` downloads the log
  instead of the folder and, where the folder has files, uploads them the same
  way `plan_link` decides today.
- Keychain access for `K` (desktop first; iOS uses the same store).
- Later, outside the spike: New Workspace toggle, the recovery-key screen,
  Import from Sync asking for the key, a lock in the Sync pane, and the web app.

## The spike

Goal: show that two devices converge through a server that provably holds no
plaintext, with the existing review behaviour intact, before any UI.

In scope:
1. `solstice-sync-crypto` with round-trip, tamper and wrong-key tests.
2. The server's relay route and tables, as above, with no compaction.
3. The client's relay transport, outbox and `relay_sv`.
4. One integration test, in the style of `apps/sync/src/web_tests.rs`, with a
   real server and two clients on temp folders.

Out of scope: web app, compaction, tamper chain, passphrase, QR transfer, any
UI, iOS, plain-to-encrypted migration.

Done when the test shows:
- Notes, renames, deletes, an attachment, bookmarks and folder colors made on
  device A (also made offline) arrive on device B.
- Concurrent offline edits to the same note converge on both devices, and an
  overlap flags a review exactly as the plain tests do.
- A marker string put in a note, its name and an attachment appears nowhere in
  the server's state dir (grep over the SQLite file and every file), nor in
  anything the server logged.
- A device with the wrong key, or a tampered or cross-vault entry, is refused
  and changes nothing.
- Killing a client mid-push and restarting it loses nothing and duplicates
  nothing.

Questions the spike must answer, in this order:
1. Can `relay_sv` be built from pulled entries alone (does `Update` expose its
   state vector), so reviews need no change to `Session`? If not, the fallback
   is a shadow `NoteDoc` of the server's state per doc, at twice the memory.
2. Does a log of per-save updates stay small enough to download for a first
   link before compaction exists? Measure on the largest real vault.
3. How much of `client.rs` (1,041 lines) assumes the y-sync handshake? If the
   transport can't be swapped behind `connect`/`send`/`incoming`, the cost
   moves up.

Open decisions for later: whether the hosted service offers encrypted vaults
only; whether to add a passphrase wrap; how the web app holds a key (typed per
session, never stored); sharing an encrypted vault between users (per-member
key wrapping, which the plain design never needed).
