# Releasing

Solstice ships two things, versioned apart:

| Tag | Workflow | Output |
|---|---|---|
| `app-v<version>` | App release | A draft GitHub Release with the desktop app for macOS and Windows |
| `sync-v<version>` | Sync image | `ghcr.io/sunstead/solstice-sync:<version>`: the sync server, with the web app built in |

## The desktop app

The version lives in `apps/desktop/package.json` (`tauri.conf.json` reads it
from there) and `apps/desktop/src-tauri/Cargo.toml`. Don't edit them by hand:
the release script keeps them in step.

1. Merge your changes to `main` as usual.
2. From the repository root, on an up-to-date, clean `main`:
   ```bash
   npm run release:app -- 0.2.0 --push
   ```
   This sets the version, commits `Release Solstice 0.2.0`, tags
   `app-v0.2.0`, and pushes both. Leave off `--push` to check the commit
   first; the script prints the push command, and how to undo it.
3. **App release** builds:
   - `Solstice_<version>_universal.dmg` (Apple Silicon and Intel)
   - `Solstice_<version>_x64-setup.exe` and `Solstice_<version>_x64_en-US.msi`

   It attaches them to a **draft** release. Try them, then press Publish on
   GitHub.

Versions with a suffix (`0.3.0-beta.1`) are marked as pre-releases. The
script refuses a version that isn't newer, a tag that exists, a dirty tree,
or a branch other than `main`. The workflow refuses a tag that doesn't match
`package.json`. If a build fails, fix it on `main` and release the next patch
version; don't move a tag that's already pushed.

Pull requests that touch `apps/desktop/src-tauri/` build both platforms
without releasing, and upload the installers as workflow artifacts for 7
days, so a change can be tried before it merges.

### Updates

Installed copies check for updates at launch and every six hours
(Settings > About, or **Check for Updates...**), and install one when the user
says so. They read `latest.json` from the newest published release
(`plugins.updater` in `tauri.conf.json`), so **pressing Publish ships the
release to everyone**; a draft or a pre-release never reaches them.

Tag builds sign the update bundles (`tauri.updater.conf.json` turns them on)
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

## Signing

Builds aren't signed yet. The macOS app is ad-hoc signed, so first launch
needs right-click > Open (or System Settings > Privacy & Security > Open
Anyway). Windows SmartScreen shows "More info > Run anyway".

To remove those prompts later:
- **macOS:** an Apple Developer ID. Add `APPLE_CERTIFICATE`,
  `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`,
  `APPLE_PASSWORD` and `APPLE_TEAM_ID` as repository secrets, and pass them to
  `tauri-action` as env.
- **Windows:** a code-signing certificate, configured under `bundle.windows`
  in `tauri.conf.json`.

Changing `identifier` in `tauri.conf.json` would move every user's settings
and sign-in to a new place, so it stays `com.sunstead.solstice`.
