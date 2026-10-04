# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Solstice is a local-first Markdown note-taking desktop app (Tauri v2 + React 19 + TypeScript), in the vein of Obsidian. A "workspace" is just a folder on disk the user opens; notes are plain `.md` files, wikilinks (`[[target]]`) resolve against the open workspace, and settings/layout persist as JSON files under a `.solstice/` folder inside that workspace (or the OS app-data dir when no workspace is open).

The repo is a monorepo, so Solstice Sync (a CRDT sync server, planned in
`Cosmos/docs/ROADMAP.md`, section 5) can live next to the app and share Rust
crates with it:

```
apps/
  desktop/        the Tauri app (@solstice/desktop): src/ (React), src-tauri/ (Rust)
  sync/           Solstice Sync's server (solstice-sync-server, bin `solstice-sync`)
crates/
  solstice-core/  vault paths, wikilinks, front matter: pure Rust, shared by app, Sync and Atlas
  solstice-sync/  the sync engine (Yjs via yrs): notes, manifest, protocol, merge review; no I/O
                  (design and decisions: docs/sync.md)
  solstice-sync-fs/      a synced vault's folder: scan, write, attachments, disk edits in
  solstice-sync-client/  a device's side: link a folder, keep it synced (used by src-tauri/src/sync/)
packages/         shared TS packages (none yet)
```

The root is an npm workspace (`apps/*`, `packages/*`) and a Cargo workspace;
`target/` and `node_modules/` live at the root. Below, `src/` and `src-tauri/`
mean `apps/desktop/src/` and `apps/desktop/src-tauri/`.

## Commands

Run from the repo root:

```bash
npm install          # once
npm run dev          # full app: tauri dev (Rust backend + webview, hot reload)
npm run dev:web      # Vite dev server only (frontend, no Tauri window)
npm run build        # tsc typecheck + vite build (frontend only)
npm run tauri build  # production app bundle
npm run lint         # eslint, whole repo
npm test             # vitest in every workspace that has tests
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings

# Solstice Sync's server, locally (state and notes under .data/):
SOLSTICE_DEV_USER=dev cargo run -p solstice-sync-server
docker build -f apps/sync/Dockerfile -t solstice-sync .   # from the root
```

Lint has 0 errors. The desktop app predates linting, so a few React Compiler
rules (`set-state-in-effect`, `refs`, `static-components`) are warnings for
existing code (`eslint.config.js`); don't add new ones. Tests sit next to the
code as `*.test.ts` (`apps/desktop/vitest.config.ts`). CI
(`.github/workflows/ci.yml`) runs lint, tests, build, cargo test and clippy.

## Architecture

### Two halves, one typed boundary

- `src-tauri/` — Rust backend (Tauri commands: filesystem ops, workspace state, native menu, keymap).
- `src/` — React frontend.
- `src/bindings.ts` is **generated** by `tauri-specta` from `specta_builder()` in [src-tauri/src/lib.rs](apps/desktop/src-tauri/src/lib.rs) every debug build (`tauri dev` / `cargo run`). Never hand-edit it. To add a Tauri command or event, write it in Rust with `#[tauri::command] #[specta::specta]`, register it in `specta_builder()`'s `collect_commands!`/`collect_events!`, then regenerate the TS side: run the app in dev mode, or `cargo run -p solstice -- --export-bindings` from `apps/desktop/src-tauri` (no window). CI fails if it's stale (`bindings_are_current`, skipped on Windows, where Tauri test binaries can't load).

### Command / keybind / menu system

One dotted-string `CommandId` enum is the single source of truth, defined via the `command_id!` macro in [src-tauri/src/commands/command_registry.rs](apps/desktop/src-tauri/src/commands/command_registry.rs) (e.g. `"edit.bold"`, `"file.new_note"`). `default_commands()` in the same file gives each id a label and default accelerator.

- [commands/keymap.rs](apps/desktop/src-tauri/src/commands/keymap.rs) resolves user overrides on top of the defaults and emits a `KeymapChanged` event when they change.
- [commands/menu_layout.rs](apps/desktop/src-tauri/src/commands/menu_layout.rs) declares the menu tree once (`menu_spec()`, a mix of `Command`/`Native`/`Separator`/`Submenu`) and resolves it against the current keymap into a `ResolvedMenu` the frontend can render. `NativeItem` (Undo/Redo/Cut/Copy/Paste/SelectAll) is deliberately *not* a `CommandMeta` — those are handled natively, not routed through the command registry.
- On macOS, [commands/menu.rs](apps/desktop/src-tauri/src/commands/menu.rs) builds a real native `Menu` from that same spec; menu clicks and OS-dispatched accelerators come back through `on_menu_event` in `lib.rs` and are re-emitted as a `MenuCommand` event. Non-macOS platforms get no native menu — the frontend renders one from `get_menu_layout` and binds every accelerator itself, since nothing else claims them (see `get_native_menu_command_ids`, which tells the frontend which ids the OS already owns on the current platform so it never double-binds).

On the frontend, [src/lib/commands.ts](apps/desktop/src/lib/commands.ts) is the dispatch layer: `registerCommand`/`runCommand` for app-global handlers, `registerScopedCommand`/`unregisterScopedCommand` for handlers that only apply to the focused editor (resolved via `useActiveEditorStore`). Keybinds are bound with `tinykeys` in `useGlobalKeybinds`; native menu activations are consumed in `useNativeMenuCommands` by listening for the `MenuCommand` event — both paths end up calling `runCommand` with the same `CommandId`, so a command's behavior is defined in exactly one place regardless of how it was triggered.

### Workspace state

A workspace is a directory path, nothing more. [src-tauri/src/workspace.rs](apps/desktop/src-tauri/src/workspace.rs) keeps it in an in-memory `HashMap<window_label, path>` (`set_workspace`/`get_workspace` commands). The frontend mirrors this in [src/hooks/use-workspace.ts](apps/desktop/src/hooks/use-workspace.ts) (`useWorkspace`), which also tracks recently-opened workspaces (`useKnownWorkspaces`) and restores the last one on startup. Switching workspaces (`setWorkspace`) resets and reloads every workspace-scoped store: layout, settings, the file tree, and the file index.

### Scoped persistence

Two storage scopes, both backed by `tauri-plugin-store` (JSON files), wired via [src/lib/stores/scoped-storage.ts](apps/desktop/src/lib/stores/scoped-storage.ts):

- `'global'` — app data dir, survives across workspaces.
- `'workspace'` — `<workspace>/.solstice/<file>.json`, scoped to the open folder.

`createScopedStorage(fileName)` returns a Zustand `StateStorage` for use with `persist` middleware; `getScopedStore` is the lower-level handle for stores that manage their own reads/writes outside Zustand's persist envelope (e.g. settings, which are written as flat hand-editable JSON rather than persist's `{state, version}` wrapper — see below).

### Settings

Every setting is declared once in [src/lib/settings/registry.ts](apps/desktop/src/lib/settings/registry.ts) (`settingsRegistry`): dotted key, section/group for the UI, `scope` (`'global'` | `'workspace'`), default, control type, and optionally how it applies itself — a `cssVar` or `domAttr` binding. [src/lib/settings/apply.ts](apps/desktop/src/lib/settings/apply.ts) pushes every such binding onto `<html>` reactively, so most appearance settings need no code beyond the registry entry (stylesheets just consume the CSS var). [src/lib/settings/store.ts](apps/desktop/src/lib/settings/store.ts) handles resolution (workspace layer overrides global overrides default), debounced disk writes, clamping/snapping numeric values to their step grid, and `visibleWhen` conditional visibility. Settings files are flat dotted-key JSON, not a Zustand persist envelope, specifically so they're safe to hand-edit and forward-compatible (unknown keys are preserved).

### Sync

A linked workspace syncs through Solstice Sync (`src-tauri/src/sync/`, `crates/solstice-sync-client`, design in [docs/sync.md](docs/sync.md)). The frontend only mirrors it: `lib/stores/sync.ts` (status and reviews, refreshed on the `syncChanged` event), the Sync settings pane, the title bar indicator, and the review bar and dialog in `components/sync/`. Two hooks matter to editors: the autosaver reports what an editor holds (`syncEditorOpened`, on load and on every adopt), and in a synced workspace a dirty note editor that sees its file change saves and reloads the merge instead of showing the conflict bar (canvases still ask: they sync whole, last writer wins).

### Editor & wikilinks

The Markdown editor is [Milkdown](https://milkdown.dev) (a ProseMirror wrapper) — see [src/components/milkdown-editor.tsx](apps/desktop/src/components/milkdown-editor.tsx) and [file-editor.tsx](apps/desktop/src/components/file-editor.tsx). Wikilinks (`[[target]]`) are implemented as a custom ProseMirror mark/plugin set in [src/lib/wikilink/](apps/desktop/src/lib/wikilink/):

- The mark wraps the literal `[[target]]` source text rather than replacing it with a node — editing a link is just editing text, with no special mode.
- A decoration plugin collapses each link to its filename unless the selection is inside it, in which case the raw source is revealed for editing.
- Link resolution status (does the target exist, is it ambiguous) comes from a workspace-wide file index (`useWikilinkIndex` / `useFileIndex`), rebuilt on workspace switch and invalidated on file create/rename/delete.
- `crates/solstice-core` ports target normalization, parsing and resolution to Rust for Sync and Atlas. The two must agree: `wikilink-index.test.ts` and `solstice-core/src/wikilink.rs` test the same cases, so change both together.

### Layout

Tab/pane layout is [flexlayout-react](https://github.com/caplin/FlexLayout), wrapped by [src/hooks/use-layout.ts](apps/desktop/src/hooks/use-layout.ts) (`useLayout`). Tabs are one of two kinds by `component`: `'editor'` (carries `{ path }` in its config) or `'blank'` (a fresh untitled tab). The model is persisted per-workspace (debounced) via the workspace-layout store. Explorer state that sits outside the FlexLayout model — sidebar width/collapse and which folders are expanded — persists alongside it in `workspace-ui.json`; `useFiles.loadRoot` replays the saved expansions after the store rehydrates. Opening a file that's already open selects its existing tab rather than duplicating it; opening a file while a blank tab is focused replaces that blank tab in place.

### UI components

The primitives come from [`@sunstead/ui`](https://github.com/Sunstead/sunstead-ui), the UI package shared by every Sunstead app, pinned to a tag in `apps/desktop/package.json`. Import them as `@sunstead/ui/components/<name>` (shadcn `base-vega` on Base UI, translucent menus, and the resizable sidebar). They were Solstice's own before they moved there, class for class, so a change to one is a change in that repo and lands in Atlas and Cosmos too. Feature components live directly under `src/components/`. Path alias `@/` → `src/` (see [vite.config.ts](apps/desktop/vite.config.ts) and [tsconfig.json](apps/desktop/tsconfig.json)).

- The package is source: `styles/app.css` imports `@sunstead/ui/styles.css` and has an `@source` for it, and `vite.config.ts` keeps it out of dependency pre-bundling.
- To work on both at once, install a packed copy (`npm pack` in sunstead-ui, then `npm install -w apps/desktop <tgz>`). Never commit it.

### Themes

The built-in themes are the shared Sunstead set (22, in Dark and Light groups), defined as CSS in `@sunstead/ui` (`[data-theme='<id>']` on `<html>`). [lib/theme/apply.ts](apps/desktop/src/lib/theme/apply.ts) sets that attribute, and lays a user theme (JSON in a themes folder, `user:` ids) over its appearance's default as inline variables. The choice lives in settings (`theme.mode`, `theme.preset`, `theme.lightPreset`, `theme.darkPreset`). `index.html` paints the last theme before the first frame from its own copy of the ids (`themes-sync.test.ts` keeps it in step). Solstice's older theme ids that merged into a Sunstead theme are mapped once by `migrateThemeIds` in `lib/settings/migrations.ts`. Solstice never sets `color-scheme`.

### Window chrome

The main window uses an overlay title bar with custom traffic-light positioning on macOS (configured in `lib.rs`'s `setup` hook) and fully custom decorations elsewhere (`decorations(false)`, drawn in React — see [src/components/title-bar.tsx](apps/desktop/src/components/title-bar.tsx) and [window-controls.tsx](apps/desktop/src/components/window-controls.tsx)).

## Conventions

- Command ids and setting keys are dotted strings (`"edit.bold"`, `"appearance.theme"`) by design — stable, greppable, and hand-editable on disk. This mirrors between Rust (`CommandId`) and TypeScript (`SettingKey`); keep new ids/keys in that style.
- Everything that reaches Tauri goes through `src/lib/backend/` (commands, events, dialogs, the opener, the window, stores, asset URLs), so the same UI can run as the web app; ESLint refuses `@tauri-apps/*` and value imports of `@/bindings` elsewhere. Types from `@/bindings` are fine anywhere.
- When adding a Tauri command: write the Rust fn with `#[tauri::command] #[specta::specta]`, add it to `collect_commands!` in `lib.rs`, run `tauri dev` once to regenerate `bindings.ts`, then call it from the frontend via `commands.xxx(...)` from `@/lib/backend` (not raw `invoke`) so it stays typed.
- When adding a new command/action: add the `CommandId` variant + default accelerator in `command_registry.rs`, place it in `menu_spec()` in `menu_layout.rs` if it belongs in a menu (then `cargo run -p solstice -- --export-bindings` refreshes `src/lib/backend/registry.json`, the web app's copy), and register its handler with `registerCommand`/`registerScopedCommand` in the frontend.
