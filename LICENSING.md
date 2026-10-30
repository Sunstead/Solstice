# Licensing

Solstice is © 2026 Sunstead LLC. Most of it is under the **GNU Affero General
Public License, version 3 or (at your option) any later version**
(`AGPL-3.0-or-later`, the root [LICENSE](LICENSE)). Three shared crates are
**MIT**, each with its own `LICENSE`.

| Licence | Paths |
|---|---|
| AGPL-3.0-or-later | `apps/desktop` (the desktop, iPad and iPhone app, and the web app built from it), `apps/sync` (Solstice Sync's server), `crates/solstice-sync`, `crates/solstice-sync-fs`, `crates/solstice-sync-client` |
| MIT | `crates/solstice-core`, `crates/solstice-pdf`, `crates/solstice-search` |

The MIT crates are shared with other Sunstead projects and have no sync logic.
An MIT crate must never depend on an AGPL one.

## What the AGPL means in practice

- **Using Solstice**, including running Solstice Sync for yourself, your family
  or your company, costs nothing and asks nothing of you.
- **Changing it and passing it on** (distributing the app, or running a
  modified server that others use over a network) means offering those users
  your changes under the AGPL. A modified server should set
  `SOLSTICE_SOURCE_URL` to where its source is; the apps and the web app show
  that link in Settings > About.
- **Selling a hosted service built on it** is allowed under the AGPL, but with
  the same obligation: you publish your modifications. You can't make a
  closed fork. The names are covered separately by [TRADEMARKS.md](TRADEMARKS.md).

## Earlier releases

Releases made before this change stay under the MIT licence they were
published with: Solstice Sync `sync-v0.1.0` to `sync-v0.5.0` and the app up to
`app-v0.8.0`. Everything released after is AGPL.

## Contributing

Pull requests need a signed [CLA](CLA.md), so Sunstead LLC can keep licensing
the whole project as one work. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Third-party code

Dependencies keep their own licences (all permissive or weak-copyleft ones that
the AGPL can include; CI checks the Rust ones with `cargo deny`, `deny.toml`).
`@sunstead/ui` is a separate MIT package.
