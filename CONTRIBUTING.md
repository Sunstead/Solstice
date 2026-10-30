# Contributing

Thanks for helping. A few things first.

## The CLA

Every pull request needs a signed [Contributor License Agreement](CLA.md).
When you open your first PR, a bot comments with the sentence to reply with;
it records your signature once, for all later PRs. You keep your copyright. The
CLA lets Sunstead LLC distribute your work under the project's licences and,
if the project ever needs it, others.

## Licences

Your contribution is licensed under the licence of the directory it goes in
(see [LICENSING.md](LICENSING.md)): AGPL-3.0-or-later for the app, the server
and the sync crates, MIT for `solstice-core`, `solstice-pdf` and
`solstice-search`. Don't paste in code you can't license that way, and don't
make an MIT crate depend on an AGPL one.

## Build and check

```bash
npm install
npm run lint
npm test
npm run build
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
```

CI runs the same. `CLAUDE.md` explains how the code is laid out and the
conventions it follows (typed Tauri boundary, dotted command ids and setting
keys, platform differences through `lib/backend/platform.ts`).

## Pull requests

Keep them focused, say what changed and why, and add tests next to the code
(`*.test.ts`, Rust unit tests). For anything large, open an issue first.
