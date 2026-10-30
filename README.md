# Solstice

A local-first Markdown note-taking app (Tauri v2, React, TypeScript) for Mac,
Windows, iPad and iPhone, in the vein of Obsidian. A workspace is a folder of
plain `.md` files; wikilinks, canvases, task boards, PDFs and handwriting work
on top of it. **Solstice Sync** (`apps/sync`) keeps folders in step between
devices and serves the same app in a browser.

```
apps/desktop/   the app (React in src/, Tauri and Rust in src-tauri/)
apps/sync/      Solstice Sync's server
crates/         Rust crates shared by the app, the server and sibling projects
```

## Develop

```bash
npm install
npm run dev        # the app, with hot reload
npm run dev:web    # the frontend in a browser
npm test && cargo test --workspace
```

`CLAUDE.md` describes the architecture; `docs/` has the designs.

## Licence

AGPL-3.0-or-later, apart from three shared MIT crates. See
[LICENSING.md](LICENSING.md). Contributions need the [CLA](CLA.md)
([CONTRIBUTING.md](CONTRIBUTING.md)). Names and logos: [TRADEMARKS.md](TRADEMARKS.md).
