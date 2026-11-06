# Releasing

Solstice ships two things, versioned apart:

| Tag | Workflow | Output |
|---|---|---|
| `app-v<version>` | App release | One rolling draft GitHub Release with the desktop app for macOS, Windows and Linux; the tag is made when you publish it |
| `sync-v<version>` | Sync image | `ghcr.io/sunstead/solstice-sync:<version>`: the sync server, with the web app built in |

## The desktop app

Releases are automatic and driven by **conventional commits**. Merging to
`main` keeps a draft up to date; **you** decide when to publish it. The whole
system, with rules for agents and troubleshooting, is in
[docs/release-automation.md](docs/release-automation.md).

### Commits

Pull requests are squash-merged, so the **PR title is the commit**. It must be

```
type(scope)!: subject        e.g.  fix(sync): keep bookmarks on rename
```

| Type | Release |
|---|---|
| `feat` | minor (0.9.1 to 0.10.0) |
| `fix`, `perf`, `revert` | patch (0.9.1 to 0.9.2) |
| any type with `!`, or a `BREAKING CHANGE:` line in the body | major (while 0.x, a minor) |
| `docs`, `style`, `refactor`, `test`, `build`, `ci`, `chore` | none; ships with the next release |

The **Conventional commits** workflow fails a PR whose title doesn't fit.
Branch names (`feat/...`, `fix/...`) are a habit, not checked. A commit that
touches only the sync server, docs or workflows never releases the app.

### What happens on a merge

1. **App release** looks at the commits touching the app (`apps/desktop`,
   `crates`, the lockfiles) since the newest **published** `app-v*` release.
   The biggest bump among them picks the version (a `fix` then a `feat` is a
   minor). With nothing releasing, it stops.
2. It builds, on `main`:
   - `Solstice_<version>_universal.dmg` (Apple Silicon and Intel)
   - `Solstice_<version>_x64-setup.exe` and `Solstice_<version>_x64_en-US.msi`
   - `Solstice_<version>_amd64.AppImage` and `.deb`, and the same for
     `aarch64`/`arm64`, built on Ubuntu 22.04 so the AppImage's glibc is old
     enough for most distributions. The AppImage updates itself; a `.deb`
     install updates through a new `.deb`.

   into **one draft** named `app-v<version>`, with release notes from the
   commit titles. Each build replaces the draft, so it always matches the
   latest merge. If the next version changed (a `feat` after a `fix`), the
   earlier version's draft is deleted once the new one is built. The version
   is set only on the build's checkout; the repo isn't touched.
3. When you want to ship, check that all four jobs of the newest run are green,
   try the installers, and press **Publish** on GitHub. That makes the tag, at
   the commit that was built, and **Release bump** commits
   `chore(release): <version> [skip ci]` to `main` so `package.json`, the
   Cargo manifests and the lockfiles say what shipped. Publishing ships
   everything merged since the last publish.

If a build fails, the draft is missing or incomplete until a later merge (a
`fix:`) or a manual run builds it again. Don't publish a draft that has fewer
assets than the last release.

**Manual runs:** Actions > App release > Run workflow. On `main` it builds a
draft even if no commit releases, at the next patch version, or at a version
you type (`1.0.0`, `0.11.0-beta.1`; a suffix makes a pre-release, which
installed apps never see). On another branch it only builds, with installers
as artifacts.

**Pull requests** build nothing by default, so a merged `feat` costs one build,
not two. `ci.yml` (lint, tests, build, clippy) still runs. To try the
installers before merging, or to check a change to packaging (the Tauri
config, `scripts/tauri-linux.sh`, the dmg), add the **`build`** label: all four
platforms build and upload the installers as workflow artifacts for 7 days,
and nothing is published.

**Speed:** only `main` saves the Rust build cache (PRs and manual runs restore
it), so a build is about 7 minutes on a warm cache and 15 on a cold one. Docs,
chore and other non-releasing merges build nothing.

The pieces: `scripts/release/conventional.mjs` (the rules),
`plan.mjs` (what to build), `set-version.mjs` (the files that carry the
version), tested by `npm run test:release` (also run in CI).

### Repository settings this relies on

- Pull requests merge by **squash** only, with the default commit message set
  to the **PR title** and **PR description** (Settings > General > Pull
  Requests), so the linted title is the commit.
- A `build` label exists.
- `main` isn't protected, so **Release bump** can push; with a ruleset, let
  `github-actions[bot]` bypass it. Optionally make **Conventional commits /
  title** a required check, so a bad title can't merge (a commit that doesn't
  fit is skipped, with a warning in the plan job).

### Updates

Installed copies check for updates at launch and every six hours
(Settings > About, or **Check for Updates...**), and install one when the user
says so. They read `latest.json` from the newest published release
(`plugins.updater` in `tauri.conf.json`), so **pressing Publish ships the
release to everyone**; a draft or a pre-release never reaches them.

Draft builds sign the update bundles (`tauri.updater.conf.json` turns them on)
with the repository secrets `TAURI_SIGNING_PRIVATE_KEY` and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`; the public half is the `pubkey` in
`tauri.conf.json`. Keep the private key and its password backed up outside
GitHub: without them no installed copy can ever be updated again, and a new
key means everyone reinstalls by hand. To make one:

```bash
npm run tauri -w @solstice/desktop -- signer generate -w ~/.tauri/solstice-updater.key
```

`releases/latest` is whichever GitHub Release is newest, so the sync server
must never publish GitHub Releases of its own (its tags are image-only), or
the app would look for `latest.json` there.

## The sync server and web app

1. Bump `version` in `apps/sync/Cargo.toml` (and its `Cargo.lock` entry) in a
   pull request, and merge it.
2. Tag the merge: `git tag -a sync-v0.2.1 -m "Solstice Sync 0.2.1"` and push
   the tag. **Sync image** publishes the image.
3. Bump `compose/solstice.yml` in Jupiter (a pull request; merging deploys).

The web app is the desktop frontend built for the browser, so any frontend
change reaches the web with the next sync release.

## Icons

The app icons are built from `apps/desktop/src/assets/icons/app/`:
`icon_square.svg` (every platform but macOS, and the web) and `mac.icon` (the
Icon Composer document for macOS's Liquid Glass icon). After changing either,
run the **App icons** workflow (it also runs on pull requests that touch
them), download its `app-icons` artifact over `apps/desktop`, and commit the
result. `npm run icons -w @solstice/desktop` rebuilds the non-macOS ones
locally; `npm run icons:mac -w @solstice/desktop` needs a Mac with Xcode 26.

## The Linux AppImage

linuxdeploy bundles the build machine's `libwayland-*` (Ubuntu 22.04's), and
a current Mesa (Arch, Fedora) can't start WebKit's EGL against them: the window
opens blank gray and the log says `Could not create default EGL display`.
`scripts/tauri-linux.sh` (the Linux `tauriScript`) runs `tauri` and then
`scripts/appimage-unbundle-wayland.sh`, which repacks the AppImage without them
and signs it again for the updater, before `tauri-action` uploads anything.

To check an AppImage from your own machine (Docker Desktop is enough; the Arch
image matches the machine, so pass the aarch64 file on Apple Silicon):

```bash
apps/desktop/scripts/test-appimage.sh Solstice_<version>_aarch64.AppImage
```

It runs the app in Arch Linux under a virtual display, writes
`appimage-test/screenshot.png` and `app.log`, and fails on a blank window. CI
runs it after every Linux build.

## Signing

Builds aren't signed yet. The macOS app is ad-hoc signed, so first launch
needs right-click > Open (or System Settings > Privacy & Security > Open
Anyway). Windows SmartScreen shows "More info > Run anyway". Linux has no
gate: an AppImage only needs `chmod +x`.

To remove those prompts later:
- **macOS:** an Apple Developer ID. Add `APPLE_CERTIFICATE`,
  `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`,
  `APPLE_PASSWORD` and `APPLE_TEAM_ID` as repository secrets, and pass them to
  `tauri-action` as env.
- **Windows:** a code-signing certificate, configured under `bundle.windows`
  in `tauri.conf.json`.

Changing `identifier` in `tauri.conf.json` would move every user's settings
and sign-in to a new place, so it stays `com.sunstead.solstice`.
