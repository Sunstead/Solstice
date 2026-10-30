# Bringing Solstice to production

Status: plan, written 2026-10-27. Nothing here is built unless it says so.
Related: `docs/sync.md` (the sync design), `docs/e2ee.md` (encrypted vaults),
`docs/iphone-roadmap.md` (the iPhone work), `RELEASING.md` (how releases are
cut today). Prices, store rules and fees below are from memory and must be
checked when each step comes up.

## The plan in one paragraph

Desktop apps stay free and open source. The iPad and iPhone app is free to
download, with a one-time unlock for the Pencil features (PDF markup,
drawings, notebooks). Solstice Sync, a hosted service from Sunstead LLC, is a
subscription tiered by storage; its vaults are end-to-end encrypted, while
self-hosted servers keep plain vaults with search and the web app. Collaboration
comes after encrypted solo vaults work.

## Decided and open

| | |
|---|---|
| Desktop apps | Free, open source (MIT). **Decided.** |
| Seller | Sunstead LLC (Virginia, sole member). **Decided.** |
| Name | Solstice, shown as "Sunstead Solstice" where "Solstice" alone is taken. **Decided**, pending the searches in Stage 0. |
| Domain | `sunstead.net`. **Decided.** |
| Vault modes | Plain and encrypted, chosen per vault at creation. **Decided.** Hosted service offers encrypted only: **recommended, open.** |
| Bookmarks | Global per workspace (shared by a vault's members). **Decided**, as today. |
| iOS pricing | Free download plus one-time unlock (about $15-25): **recommended, open.** Paid upfront is the alternative. |
| Sync pricing | Storage tiers: **recommended, open.** Numbers wait for real usage. |
| Hosting | One VPS in US East with offsite backups: **recommended, open.** |
| Public sign-in | Needs an identity provider other than the self-hosted Authentik: **open.** |
| Collaboration | After encrypted solo vaults: plain vaults first, encrypted later (`docs/e2ee.md`). **Open.** |
| Licence | AGPL-3.0-or-later for the app, the server and the sync crates; `solstice-core`, `solstice-pdf` and `solstice-search` stay MIT; CLA for contributors (`LICENSING.md`). **Decided.** |

## Where things stand (checked 2026-10-27)

- AGPL-3.0-or-later, copyright Sunstead LLC (three shared crates are MIT); see `LICENSING.md`. Releases up to `sync-v0.5.0` and `app-v0.8.0` stay MIT. The CLA is a draft for an attorney to read before the first outside PR.
- CI runs lint, tests, build, cargo test and clippy. Release workflows exist
  for the desktop app (macOS universal `.dmg`, Windows `.exe` and `.msi`, into a
  draft release), the sync image (`ghcr.io/sunstead/solstice-sync`) and app icons.
- The desktop updater works, with signed update bundles.
- **Not done:** macOS notarization (the release notes tell users to
  right-click > Open), Windows code signing, a Linux build, crash reporting,
  an iOS build or TestFlight step in CI, an iOS privacy manifest
  (`PrivacyInfo.xcprivacy` isn't in the repo), and opening an iOS workspace
  from outside the app's own Documents folder.
- iOS is signed with a free Apple ID today (7-day profiles, no TestFlight).

## Stage 0: the company, accounts and name

None of this is code, and several items have waiting periods, so start them
first.

- [ ] **Apple Developer Program as an organization, under Sunstead LLC.** An
      organization account needs a D-U-N-S number (free, from Dun & Bradstreet;
      it can take days to weeks), and makes the seller "Sunstead LLC" instead
      of a personal name. One membership covers the App Store, TestFlight and
      macOS notarization. The existing bundle id `net.sunstead.solstice` stays.
- [ ] **Business basics.** A business bank account and card in the LLC's name
      for Apple payouts, the VPS, domains and signing certificates. Ask an
      accountant about Virginia and other states' sales tax on software
      subscriptions. Apple and a merchant of record (Paddle, Lemon Squeezy) collect
      and remit it on their sales, so most of it is theirs. This isn't legal
      advice.
- [ ] **Name.** Search the USPTO trademark database (classes 9 and 42) and
      the App Store for "Solstice" and "Sunstead Solstice". "Sunstead Solstice" is
      17 characters, inside the App Store's 30-character limit. Create the app
      record in App Store Connect early: that reserves the name.
- [ ] **A privacy policy and terms** on `sunstead.net`. The App Store needs
      the policy's URL; the hosted service needs both. Keep the policy honest and
      short: what the app stores, what sync stores, what encrypted vaults hide.
- [ ] **A support email** on the domain, with SPF, DKIM and DMARC set up so
      receipts and invitations don't land in spam.
- [x] **Licence decisions.** AGPL for the app, server and sync crates, a CLA
      for contributors (`LICENSING.md`, `CLA.md`). As sole copyright holder,
      Sunstead can ship its own App Store build under its own terms.
- [ ] **Licence paperwork.** A lawyer reads `CLA.md` before the first outside
      PR, and the author signs a one-page confirmation that their commits are
      licensed or assigned to Sunstead LLC.

## Stage 1: sunstead.net

The domain needs updates across the board, and the product needs a front door.

- [ ] A Solstice page: what it is, screenshots (iPad with Pencil first),
      downloads, a short "your notes are plain files" explanation.
- [ ] Docs: install, workspaces, sync, self-hosting the sync server (the
      Docker image and its `SOLSTICE_*` settings are documented in `docs/sync.md`).
- [ ] Subdomains: `sync.sunstead.net` for the server and web app, a status
      page, `docs`. Set up `apple-app-site-association` there for universal
      links (the app's `solstice://open` links) when iOS ships.
- [ ] Privacy, terms, support and a changelog linked from the footer.
- [ ] Atlas and Cosmos, the other Sunstead apps, get the same treatment, so
      the site reads as a company with products, not one project.

## Stage 2: public desktop beta

1. [ ] **Notarize macOS** with the Developer ID (needs Stage 0). The secrets
       are listed in `RELEASING.md`; wire them into `app-release.yml`, and remove
       the "not notarised yet" text from the release notes.
2. [ ] **Sign Windows builds** (Azure Trusted Signing or a certificate), so
       SmartScreen doesn't warn.
3. [ ] **Add a Linux build** (AppImage and deb) to the release workflow.
4. [ ] **Opt-in crash reporting,** off by default, with a clear switch in Settings.
5. [ ] **Back up the updater signing key** outside GitHub, as `RELEASING.md` says.
6. [ ] Release as `0.x`, pre-release label, a feedback channel (GitHub
       Discussions or a forum).

## Stage 3: iOS and iPad

1. [ ] **Storage first.** Let a workspace live in iCloud Drive or any folder
       the user picks (security-scoped access), so deleting the app doesn't delete
       notes. Until then, the paid or unlocked app has a data-loss trap.
2. [ ] **Privacy manifest** (`PrivacyInfo.xcprivacy`) for the app and the native
       plugin, and an audit of the required-reason APIs used. Declare encryption
       use in the export-compliance answers.
3. [ ] **CI for iOS:** build, sign and upload to TestFlight from a tag (a new
       `ios-v*` tag alongside `app-v*`). Add it to `RELEASING.md`.
4. [ ] **TestFlight beta** with Pencil users: students and researchers, on
       iPads and iPhones. Target: no data loss reports, ink and PDF saves
       behaving, sync stable.
5. [ ] **In-app purchase:** the one-time unlock, plus the account deletion and
       sign-in rules App Review applies once sync accounts exist. The app must work
       fully without an account, and review needs either that or a demo login (the
       dev-user shortcut doesn't exist against a real server).
6. [ ] **Store listing:** iPad and iPhone screenshots, Pencil-first copy, the
       iOS 27 requirement stated plainly, the privacy URL, review notes explaining
       the PDF, ink and sync features.
7. [ ] **Pricing choice** (free plus unlock vs paid upfront) made before the
       listing goes in; changing later means grandfathering buyers.

## Stage 4: hosted sync

In order, each unblocking the next:

1. [ ] **Encrypted-vault spike** (`docs/e2ee.md`). It decides the shape of the
       server, the web app and collaboration. Change the plan's `vaults.key_wrap`
       to a per-recipient table with key epochs now, so sharing stays possible.
2. [ ] **Public sign-in.** Today's auth is Authentik, which suits friends
       and family. For customers, choose Sign in with Apple plus Google, or a hosted
       identity provider. Check whether `apps/sync` accepts more than one issuer
       (the `users` table keys by issuer and subject, but the config takes one).
3. [ ] **Hosting.** One VPS in US East (Lightsail or Hetzner Ashburn),
       Docker behind Caddy, Litestream or restic to a different provider for
       backups, uptime monitoring, and a status page. Do a restore drill before
       the first customer.
4. [ ] **Quotas and billing.** Server-side byte accounting (after compaction
       for encrypted vaults), soft limits that block new attachments but never
       text edits or downloads, a per-file size limit. Subscriptions through App
       Store in-app purchases on iOS and a merchant of record elsewhere.
5. [ ] **Terms, privacy and account deletion** live, with a data-export path
       (the files are plain, so this is easy).
6. [ ] **Invite-only beta,** then paid. Measure real storage per user for a few
       months before fixing tier sizes.

Scaling when needed, in order: a bigger box; blobs to object storage; shard by
user across identical servers (vaults don't interact, so this needs no
redesign); Postgres only if SQLite stops being enough.

## Stage 5: later

- Collaboration on plain vaults: members and roles, a `can(user, vault,
  action)` check in front of every route, invitations, attribution by user.
  Bookmarks stay shared. Then near-live co-editing, then encrypted sharing.
- The web app for encrypted vaults (the sync engine as WASM, keys in the browser).
- Version history for notes in the UI, if it isn't already there.

## Running through every stage

- **Data-safety tests.** Kill the app mid-save, fill the disk, go offline
  mid-merge, restore from a backup. Losing someone's notes is the failure that
  ends trust in a notes app.
- **A restore drill** for the server's backups, repeated after any change to
  storage.
- **Changelog and docs** kept current with each release.
- **Keep the encrypted-vault claims narrow and true:** contents and names are
  hidden from the server; its existence, sizes and timing are not.

## Next three actions

1. Start the Apple Developer organization enrollment (the D-U-N-S wait is the
   long one) and the trademark and App Store name searches.
2. Wire notarization into `app-release.yml` once the account exists, and start
   the iCloud Drive folder work.
3. Run the encrypted-vault spike in its own session.
