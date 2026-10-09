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
npm run icons -w @solstice/desktop    # app and web icons from icon_square.svg (macOS: icons:mac, on a Mac)
npm run release:app -- 0.2.0 --push   # desktop release: bump, tag app-v0.2.0 (RELEASING.md)

# Solstice Sync's server, locally (state and notes under .data/):
SOLSTICE_DEV_USER=dev cargo run -p solstice-sync-server
docker build -f apps/sync/Dockerfile -t solstice-sync .   # from the root

# The web app against that server: the desktop frontend in a browser, with
# /v1 and /auth proxied to SOLSTICE_SYNC_URL (default http://127.0.0.1:8080).
npm run dev:web      # then open http://localhost:1420
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

Canvas commands (`canvas.*`, `CommandId::is_canvas`, `lib/command-scope.ts`) are scoped to a focused board, so their defaults are plain keys (`N`, `F`, `M`, `Shift+1`). `useGlobalKeybinds` groups bindings by key and runs the canvas command only when the keystroke lands on `[data-canvas-board]` outside a card editor, otherwise the global one with that key, if any. The native menu never registers canvas accelerators (macOS would claim `N` everywhere), and the Keyboard pane only flags conflicts within a scope. `toTinykeysFormat` writes digits and punctuation as `event.code` names (`Digit1`, `Quote`), since their `event.key` changes with Shift and layouts.

### Workspace state

A workspace is a directory path, nothing more. [src-tauri/src/workspace.rs](apps/desktop/src-tauri/src/workspace.rs) keeps it in an in-memory `HashMap<window_label, path>` (`set_workspace`/`get_workspace` commands). The frontend mirrors this in [src/hooks/use-workspace.ts](apps/desktop/src/hooks/use-workspace.ts) (`useWorkspace`), which also tracks recently-opened workspaces (`useKnownWorkspaces`) and restores the last one on startup. Switching workspaces (`setWorkspace`) resets and reloads every workspace-scoped store: layout, settings, the file tree, and the file index.

The workspace dialogs live in [components/workspace-dialogs/](apps/desktop/src/components/workspace-dialogs/) (opened through `useWorkspaceDialogs`):
- **New workspace** (`file.new_workspace`) makes an empty folder with `create_workspace` (an empty one is adopted, a full one refused), and with sync on, a new vault of the same name. On the web it makes a vault.
- **Import from sync** (`file.import_from_sync`, desktop) makes a folder and links it to a vault already on the server, which downloads into it.
- **Open folder as workspace** (`file.open_folder`, desktop) takes any folder as it is.
- **Manage workspaces** (`file.manage_workspaces`) removes them. On desktop that only forgets the workspace (`useKnownWorkspaces.forget`); its folder stays. On the web it deletes the vault on the server, after typing its name. The open workspace can't be removed.

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
- A target's `#heading` or `#^block` (a block id, Obsidian's `^id` at the end of a block) opens the note there: `openWikilink` leaves an anchor request (`lib/stores/anchor.ts`) that the note's editor takes once loaded. `![[note#^id]]` embeds the block (`sliceBlock`).

**Source mode** (`view.toggle_source_mode`, Cmd+/; Alt+/ on the web, where Safari has Cmd+/) shows a note as raw markdown in CodeMirror (`source-editor.tsx`), with the same autosaver, sync and external-change handling as the rich editor. The mode is the tab's (`config.mode`), so it persists with the layout; `FileView` keys `FileEditor` by path and mode, and switching hands the outgoing editor's text to the incoming one (`lib/stores/editor-text.ts`) rather than rereading a file whose last save may still be on its way.

Obsidian's other syntax: `==highlight==` is a mark (`lib/highlight/`), paired over the parsed tree, and registered before commonmark (`editorOuterMarks`) so it nests outside `strong` when written back. `%%comments%%` and `^ids` stay plain text with decorations (`lib/comment/`, `lib/blockid/`); read-only views drop comments (`stripComments`). Front matter is one atom node holding the block verbatim (`lib/frontmatter/`), by `split_front_matter`'s rule.

### Layout

Tab/pane layout is [flexlayout-react](https://github.com/caplin/FlexLayout), wrapped by [src/hooks/use-layout.ts](apps/desktop/src/hooks/use-layout.ts) (`useLayout`). Tabs are one of two kinds by `component`: `'editor'` (carries `{ path }` in its config) or `'blank'` (a fresh untitled tab). The model is persisted per-workspace (debounced) via the workspace-layout store. Explorer state that sits outside the FlexLayout model — sidebar width/collapse and which folders are expanded — persists alongside it in `workspace-ui.json`; `useFiles.loadRoot` replays the saved expansions after the store rehydrates. Opening a file that's already open selects its existing tab rather than duplicating it; opening a file while a blank tab is focused replaces that blank tab in place.

### UI components

The primitives come from [`@sunstead/ui`](https://github.com/Sunstead/sunstead-ui), the UI package shared by every Sunstead app, pinned to a tag in `apps/desktop/package.json`. Import them as `@sunstead/ui/components/<name>` (shadcn `base-vega` on Base UI, translucent menus, and the resizable sidebar). They were Solstice's own before they moved there, class for class, so a change to one is a change in that repo and lands in Atlas and Cosmos too. Feature components live directly under `src/components/`. Path alias `@/` → `src/` (see [vite.config.ts](apps/desktop/vite.config.ts) and [tsconfig.json](apps/desktop/tsconfig.json)).

- The package is source: `styles/app.css` imports `@sunstead/ui/styles.css` and has an `@source` for it, and `vite.config.ts` keeps it out of dependency pre-bundling.
- To work on both at once, install a packed copy (`npm pack` in sunstead-ui, then `npm install -w apps/desktop <tgz>`). Never commit it.

### Themes

The built-in themes are the shared Sunstead set (22, in Dark and Light groups), defined as CSS in `@sunstead/ui` (`[data-theme='<id>']` on `<html>`). [lib/theme/apply.ts](apps/desktop/src/lib/theme/apply.ts) sets that attribute, and lays a user theme (JSON in a themes folder, `user:` ids) over its appearance's default as inline variables. The choice lives in settings (`theme.mode`, `theme.preset`, `theme.lightPreset`, `theme.darkPreset`). `index.html` paints the last theme before the first frame from its own copy of the ids (`themes-sync.test.ts` keeps it in step). Solstice's older theme ids that merged into a Sunstead theme are mapped once by `migrateThemeIds` in `lib/settings/migrations.ts`. Solstice never sets `color-scheme`.

### The web app

The same frontend runs in a browser as the web app, served by the Solstice Sync server (`SOLSTICE_WEB_DIR`, built into its image) at its own address. Signing in opens the user's vaults on the server; there are no local folders. `src/lib/backend/` picks the backend at startup: in the desktop shell the Tauri commands, in a browser `lib/backend/web/`, which answers the same `commands` and `events` from the server's web routes (`apps/sync/src/web_api.rs`).
- A workspace is a vault, at the path `/<vault name>`. The file tree comes from the server, and its change socket (`/v1/web/events`) becomes `fileSystemChanged` events, so the explorer, tabs and external-change handling work unchanged.
- A note is read with a `base` and saved against it: the server merges the save with whatever other devices did since, as a synced desktop folder does. Saves go through a journal in IndexedDB (`lib/backend/web/notes.ts`, `journal.ts`), one at a time per file, each with a `save_id` the server applies once, so a lost signal or a closed page never loses or doubles an edit.
- A failed write never closes the editor: the autosaver keeps the edit, retries (backoff, and when the page, network or sync comes back), and the editor shows `SaveFailedBar`. The autosaver also flushes when the page hides, since iOS rarely fires `beforeunload`.
- Settings and layout are kept on the server per user (`/v1/web/settings`), not in `.solstice/`; the workspace list is the user's vaults.
- Shortcuts: browsers keep Ctrl/Cmd+N, T and W, so `registry.json` carries the web's own defaults (Alt+N, Alt+T, Alt+W, Alt+Shift+N; `web_commands()` in `command_registry.rs`) and leaves out what the web can't do (`NOT_ON_WEB`: open a folder, show in the file manager).
- What needs a computer is hidden or says so: window controls, picking a folder, theme folders, system fonts, showing a file in the file manager, the Sync pane (the web shows the account and Sign out instead). File pickers hand back blob URLs that `importAttachment` uploads. `/open?vault=&path=` is the web's `solstice://open` link.

### Window chrome

The main window uses an overlay title bar with custom traffic-light positioning on macOS (configured in `lib.rs`'s `setup` hook) and fully custom decorations elsewhere (`decorations(false)`, drawn in React — see [src/components/title-bar.tsx](apps/desktop/src/components/title-bar.tsx) and [window-controls.tsx](apps/desktop/src/components/window-controls.tsx)).

The menu, Back, Forward and sync buttons ([header-controls.tsx](apps/desktop/src/components/header-controls.tsx)) render once, in the title bar, and never move. The title bar spans only the sidebar column; when the sidebar collapses it narrows to the rail and the controls overhang the top-left tab strip, whose `HeaderControlsSpacer` (`leading` in `onRenderTabSet`) makes room for them. The spacer is sized from where it actually is on every resize of the editor area (a `ResizeObserver`, same frame), not animated alongside the sidebar: two animations never quite agree, and the tabs bounced. Don't copy them into the tab strip, and don't give the title bar's children a `z-index` (a stacking context there puts the controls under the editor).

**Phone layout.** Below 768px (`useSidebar().isMobile`, sunstead-ui's `useIsMobile`), on the web, in the iPhone app and in a narrow desktop window (Tauri's minimum is 400×500), the shell drops the title bar, sidebar and tab strip: `EditorArea` renders [PhoneShell](apps/desktop/src/components/mobile/phone-shell.tsx) instead of `FlexLayoutRoot`, Discord-style. Home is a page per footer item (Files, Search, You); a note slides in over it from the right (`PushPane`, Web Animations, back by its chevron or a swipe from the left edge; a swipe left on home brings it back). Where it is lives in `lib/stores/phone-nav.ts`, with the note history by path, since a file opened here replaces the shown tab (`useLayout.openInPlace`) instead of piling up unseen tabs; the tab switcher still lists them all. The note is the shown tab of the same flexlayout model, so splits survive and return on a wider window. Both views share `useLayoutSession` (workspace load, tab and history commands, model-change bookkeeping); mount only one. The Files page stays mounted behind the others, because the file tree registers New Note/Folder/Canvas; naming one (or revealing a file) goes back to it. You holds the account, the workspace and settings: `SettingsDialog` renders nothing here, and `openSettings(section)` pushes that section as a page. There's no File/Edit/View menu on a phone or on iOS (`can.appMenu`); what was only there lives in the note's ⋯ sheet (`useEntryMenuItems`, Show Source included) and the keyboard bar. The desktop sidebar collapses with sunstead-ui's `collapsible="rail"`: the file-tree panel keeps its layout (and is `inert`) while the edge sweeps over it. On a board, touch pans on empty space and pinches with two fingers (`pinchView`); the image viewer does the same.

**The on-screen keyboard.** iOS ignores `interactive-widget`, so `useVisualViewport` sizes the app root to the visual viewport (`--app-height`) and undoes iOS's page scroll; the editor then ends at the keyboard. While a note editor has focus on a touch screen with the keyboard up, `KeyboardBar` (`components/mobile/`) sits above it with the Format commands, Tab's indent and outdent included, pressed for what's in effect (`activeFormats`) and dimmed when they can't apply. Lists answer Enter and Backspace the way notes apps do (`lib/editor/list-keymap.ts`); iOS sends a line-start Backspace shifted, so `Shift-Backspace` is bound to the same. `/` at the start of a line opens `SlashMenu` (`lib/slash/`), on every platform. The root pads for the safe areas at the top and sides; the bottom one is left to what scrolls, so content runs under the home indicator.

**Tab motion** ([lib/tab-motion.ts](apps/desktop/src/lib/tab-motion.ts)) is visual only: the model changes at once and the buttons ease after it, with the Web Animations API, never CSS transitions or mount animations (those replay on load, drags and selection changes). It relies on the tab CSS in `flexlayout.css`: tabs are `flex: 0 1 12rem` (exactly 12rem when there's room), a selected tab takes the same room as an unselected one (12.25rem and no margins vs 12rem and 0.125rem margins, equal content boxes), and the tab container leaves room for the + button so flexlayout never docks it mid-animation. Opening: only ids passed to `markEntering` (New tab, Open in new tab, opening a file with no blank tab to reuse) animate; `markEntering` snapshots every tab's room, and `playEnter` (in a microtask, after flexlayout's overflow check) eases every tab and the container explicitly from before to after, so nothing drifts on how flexbox shares space mid-way. Rapid opens (holding Ctrl/Cmd+T) restart from what's on screen: `markEntering` records every tab's current room and cancels the running animations before the new tab lands, so flexlayout's overflow check never sees widths an animation is holding (it would dock the + button), and `animateStrip` handles every tab opened in the same render together. Closing: `<Layout onAction>` turns flexlayout's `DELETE_TAB` (close button, its keyboard close) into `closeTab`, as do middle-click and Close Tab; the neighbour is selected immediately, the button collapses (absorbing the 1px divider that leaves with it), then the tab is deleted. A pointer close in a squeezed strip holds every tab's room (`--tab-held`, margins included, so selection can't shift it) until the pointer leaves the strip. Code that closes tabs for other reasons calls `Actions.deleteTab` on the model directly and skips all of it. Frame sampling (every tab's label edge per rAF, from full and squeezed strips) is how this was checked; re-run something like it after touching tab CSS.

### Icons and releases

- **Icons:** `src/assets/icons/app/icon_square.svg` is the flat icon (Windows, Linux, mobile, the web's favicon, touch icon and manifest; `npm run icons -w @solstice/desktop`, `scripts/build-icons.mjs`). `mac.icon` is the same design as an Icon Composer document, compiled to `src-tauri/icons/Assets.car` (Liquid Glass, `CFBundleIconName` in `src-tauri/Info.plist`) and the fallback `icon.icns` by `scripts/build-mac-icon.sh`, which needs Xcode 26. The **App icons** workflow runs both on a Mac and uploads the results; outputs are committed. The glass icon only shows in a bundled build.
- **Releases:** the desktop app's version is `apps/desktop/package.json` (`tauri.conf.json` reads it). `npm run release:app -- <version> --push` bumps it and the app crate, commits and tags `app-v<version>`; **App release** builds a universal macOS `.dmg` and Windows installers into a draft GitHub release. The sync server is versioned apart (`sync-v*`). See [RELEASING.md](RELEASING.md).
- **Updates:** the desktop app updates itself with `tauri-plugin-updater` from the newest published release's `latest.json`, signed on tag builds (`tauri.updater.conf.json`, the `TAURI_SIGNING_*` secrets). The frontend is `lib/backend/updater.ts` and `lib/stores/updates.ts` (`can.updates`): a title-bar indicator, `UpdateDialog`, `app.check_for_updates` and Settings > About. Installing flushes every autosaver first (`flushAllAutosavers`).

## Conventions

- Command ids and setting keys are dotted strings (`"edit.bold"`, `"appearance.theme"`) by design — stable, greppable, and hand-editable on disk. This mirrors between Rust (`CommandId`) and TypeScript (`SettingKey`); keep new ids/keys in that style.
- Everything that reaches Tauri goes through `src/lib/backend/` (commands, events, dialogs, the opener, the window, stores, asset URLs), so the same UI can run as the web app; ESLint refuses `@tauri-apps/*` and value imports of `@/bindings` elsewhere. Types from `@/bindings` are fine anywhere.
- Platform differences go through `lib/backend/platform.ts`: `shell` (`desktop`, `mobile` for Tauri on iOS, `web`) and `can.*` (`localFolders`, `pickFolders`, `windowChrome`, `fileManager`, `themeFolders`, `syncSettings`...). Ask for the ability, not the shell. `inTauri` only picks the backend's implementation. In Rust, a computer's APIs (window size, menus, the OS trash) are `#[cfg(desktop)]`; on a phone, trash goes to the workspace's `.solstice/trash/`.
- The iOS app: `src-tauri/gen/apple` is the generated Xcode project (committed; `tauri ios init` regenerates it), and `src-tauri/Info.ios.plist` is merged into its Info.plist (Files-app access to the workspaces in Documents). iOS moves the app's container, and so its Documents, on a reinstall or update: saved workspace and tab paths are re-rooted on load (`rerooted` in `lib/stores/known-workspaces.ts`). The simulator's hardware keyboard hides the on-screen one; turn it off to test the keyboard bar. `cargo check -p solstice --target aarch64-apple-ios-sim` checks the Rust side; `npm run tauri ios dev -w @solstice/desktop -- "iPhone 17 Pro"` runs it in the simulator (needs Xcode, the iOS Rust targets and CocoaPods). Sign-in still uses the desktop's loopback flow, which iOS suspends; against a `SOLSTICE_DEV_USER` server there's no sign-in.
- When adding a Tauri command: write the Rust fn with `#[tauri::command] #[specta::specta]`, add it to `collect_commands!` in `lib.rs`, run `tauri dev` once to regenerate `bindings.ts`, then call it from the frontend via `commands.xxx(...)` from `@/lib/backend` (not raw `invoke`) so it stays typed.
- When adding a new command/action: add the `CommandId` variant + default accelerator in `command_registry.rs`, place it in `menu_spec()` in `menu_layout.rs` if it belongs in a menu (then `cargo run -p solstice -- --export-bindings` refreshes `src/lib/backend/registry.json`, the web app's copy), and register its handler with `registerCommand`/`registerScopedCommand` in the frontend.
