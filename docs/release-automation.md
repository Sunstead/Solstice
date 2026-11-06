# Release automation

How the desktop app gets from a merged pull request to a published release:
conventional commits pick the version, `main` builds one rolling draft, and
publishing it is the only manual step. [RELEASING.md](../RELEASING.md) is the
short how-to; this is the whole system, for people and for agents (Claude
sessions) that open PRs here.

Introduced in PR 85 (2026-11-06), replacing `npm run release:app`, which
bumped the version, tagged it and pushed by hand.

## At a glance

```
PR title ──squash──▶ commit on main ──▶ App release workflow
 feat(editor): …                          │
                                          ├─ plan: which commits since the last PUBLISHED
                                          │         release touch the app? what version?
                                          ├─ nothing releases ─▶ stop (docs/chore/…)
                                          └─ build 4 platforms ─▶ ONE draft  app-v<version>
                                                                    │
                                you press Publish ◀─────────────────┘
                                          │
                                          ├─ GitHub makes the tag (at the built commit)
                                          └─ Release bump commits the version to main
```

- **The PR title is the commit message**, and it has to be a conventional
  commit. That is the only thing contributors (and agents) must get right.
- **Nothing builds on PRs** unless they carry the `build` label, so a merge
  costs one build, not two.
- **There is one draft at a time.** Each releasing merge rebuilds it; you
  publish when you like, so several merges can ship in one release.
- **The version lives in the tag first.** Builds stamp it into their own
  checkout; the repo's files catch up when you publish.

## For people

### Writing PR titles

```
type(scope)!: subject
```

| Type | Release it asks for | Use for |
|---|---|---|
| `feat` | minor (0.9.1 → 0.10.0) | something users can do that they couldn't |
| `fix` | patch (0.9.1 → 0.9.2) | a bug users could hit |
| `perf` | patch | faster or lighter, same behavior |
| `revert` | patch | undoing an earlier change |
| `docs`, `style`, `refactor`, `test`, `build`, `ci`, `chore` | none | no user-visible change |

- `scope` is optional free text (`editor`, `sync`, `ios`, `linux`…); it shows
  in the release notes as **scope:**.
- `!` after the type or scope (`feat(sync)!: …`), or a line starting
  `BREAKING CHANGE:` in the PR description, is a **major** bump, but while the
  app is 0.x it is a minor one (features are minor too). Breaking changes get
  their own heading in the notes.
- The type is lowercase and the subject follows `: ` (colon, then a space). `Fix: x`, `feat:x`, `Linux: fix the AppImage` and GitHub's own
  `Revert "…"` titles are **not** valid; the title check fails them.
- The biggest bump among the commits since the last published release wins:
  a `fix` then a `feat` is one minor release.
- Only commits that **touch the app** count (`apps/desktop/`, `crates/`,
  `Cargo.toml`, `Cargo.lock`, `package.json`, `package-lock.json`). A `fix:`
  that only changes the sync server (`apps/sync/`), docs or workflows releases
  nothing.
- Write the subject for the release notes: it is shown as written, so make it
  readable by a user (`wrap code lines`, not `fix wrapLines bug in cm ext`).

### Day to day

1. Open a PR with a conventional title. **Conventional commits / title** and
   `ci.yml` run on it. Fix a bad title by editing it; the check re-runs.
2. Merge with **Squash and merge** (the only option). The commit is the
   PR title, and the PR description is its body.
3. If the merge releases, **App release** builds (about 15 minutes cold, 7 warm;
   see [Speed](#speed-and-caches)) and updates the draft on the
   [Releases page](https://github.com/Sunstead/Solstice/releases). If not, it
   stops after a few seconds.
4. When you want to ship: open the newest **App release** run on `main`, check
   that all four platform jobs are green (and the Linux smoke tests), skim the
   draft's notes and assets (compare with the last release: dmg, exe, msi,
   AppImage and deb for x86_64 and arm64, a `.sig` for each updater bundle, and
   `latest.json`), try an installer if you want, and press **Publish**.
5. Publishing makes the tag and ships the update to every installed copy (the
   updater reads `latest.json` from the newest published release). A minute
   later **Release bump** commits `chore(release): <version> [skip ci]` to
   `main`. Check that commit appears.

Don't publish while a build is running: the draft is being replaced under you.
A draft with fewer assets than the last release is a failed build; don't
publish it, merge a fix or run the workflow again.

### Building a PR's installers

Add the **`build`** label. All four platforms build (restoring `main`'s Rust cache), the Linux AppImage
is smoke tested, and the installers are uploaded as workflow artifacts for 7
days. Nothing is published or signed. Use it for changes to packaging: the Tauri
config, `scripts/tauri-linux.sh`, the dmg, file associations, anything where
"it compiles" isn't enough. New pushes to a labelled PR rebuild it.

### Manual runs

Actions → **App release** → Run workflow:

- **On `main`:** builds a draft even if no commit releases. The version is the
  commits' (if any release), else the next patch, or what you type. Use it to
  rebuild after a failed build, to cut a first test draft, or for a version
  the commits wouldn't give (`1.0.0`).
- **On another branch:** builds only, installers as artifacts; never publishes.
- **Version input:** `1.0.0` or `0.11.0-beta.1`, a leading `v` is stripped. It must be newer than the last published release. A suffix makes
  a **pre-release** draft: installed apps never update to a pre-release, and
  publishing one doesn't bump the repo.

### Before 1.0

While the version is 0.x, breaking changes bump the minor. To go to 1.0.0, run
the workflow manually on `main` with version `1.0.0`; after that, `!` bumps
the major.

### Troubleshooting

| Symptom | Cause and fix |
|---|---|
| PR can't merge: **title** check fails | The title isn't conventional; edit it. |
| Merged, nothing built | The merge didn't release: a non-releasing type, only non-app files, or a title that wasn't conventional (the plan job's log shows `Not a conventional commit`). Fix forward with a `fix:`/`feat:` PR, or run the workflow manually. |
| Draft missing | A build is under way (each build deletes and recreates the draft), or it failed before uploading. Look at the newest run. |
| Draft has some platforms only | A platform job failed. Re-run its job from the run page, or merge/dispatch again. |
| `Found release with tag … but it's NOT a draft` | You published that version and the workflow tried to build it again; it can't happen from normal merges, since the next version is above the published one. |
| No bump commit after publishing | Pre-releases don't bump. Otherwise see the **Release bump** run: the deploy key, the ruleset's bypass or a rebase race. |
| Cold build after a long quiet spell | GitHub drops caches unused for 7 days. Harmless: the next `main` build refills it. |
| Linux AppImage: blank gray window on Arch | The smoke test catches it. See "The Linux AppImage" in RELEASING.md. |

## For agents (Claude sessions and other automation)

Follow these when you open or merge pull requests in this repo.

1. **Name the PR, not just the commits.** The PR title is the release
   decision. Use `type(scope)!: subject` with the types above. Commit
   messages on the branch are discarded by the squash (only the PR title and
   description survive), but keep them tidy.
2. **Pick the type by user-visible effect**, not by effort. A bug fix is `fix`,
   not `feat`. Refactors, tests, docs and CI are never `fix`/`feat`, however big
   (so they don't trigger a 4-platform build). If a change fixes a bug *and*
   refactors, it is a `fix`.
3. **Breaking changes** (a saved-file or settings format that older versions
   can't read, a removed command, a sync protocol change): use `!`, and
   explain in the PR description with a `BREAKING CHANGE:` line, since that
   text becomes the commit body.
4. **Never bump versions or tag.** Don't edit `version` in
   `apps/desktop/package.json`, `Cargo.toml`, `Cargo.lock`'s `solstice` entry or
   the iOS project by hand, don't push `app-v*` tags and don't run
   `set-version.mjs` on a branch. The build and the bump workflow do it.
   `npm run release:app` no longer exists.
5. **Never push to `main`.** It is protected: changes go through a PR, squash
   only, with the title check passing. Don't try to bypass the ruleset.
6. **Never publish, edit or delete a release or its draft**, and don't run the
   manual workflow on `main` unless the user asks (it builds a real draft,
   ~15 minutes of four runners). Publishing ships to every install and is the
   user's call alone.
7. **Add the `build` label** (or tell the user to) when the PR changes
   packaging: `apps/desktop/src-tauri/tauri*.conf.json`, `Info*.plist`,
   `scripts/tauri-linux.sh`, `appimage-unbundle-wayland.sh`,
   `test-appimage.sh`, `solstice.desktop.hbs`, bundle or signing config, or
   `.github/workflows/app-release.yml`. A broken installer otherwise shows up
   only after merge. Don't add it to ordinary code PRs.
8. **Don't poll CI.** Use the PR tools (`bind_pr`, `get_status`); the user says
   when to merge. After a merge, don't poll the release build either.
9. **When changing this system** (the workflows or `scripts/release/`): keep
   `conventional.mjs`, its tests and this file in step; run
   `npm run test:release`; use a `ci:` (or `build:`) title so the change doesn't
   itself release; and add the `build` label if `app-release.yml` changed.
   Don't hard-code the type list elsewhere: `TYPES` in `conventional.mjs` is the
   one definition (the title check and the planner both use it).
10. **A revert** needs a conventional title (`revert: wrap code lines`);
    GitHub's default `Revert "…"` title fails the check. Rename it.
11. **Docs and chore PRs are free**: no build, no release. Prefer them to
    bundling doc edits into a `feat`.

## How it works

### Files

| File | Role |
|---|---|
| `scripts/release/conventional.mjs` | The rules: `TYPES`, `parseCommit`, `levelOf`, `bumpVersion`, `nextVersion`, `releaseNotes`. No dependencies. |
| `scripts/release/plan.mjs` | Decides what a workflow run does (`decide`, pure) and gathers its inputs from `gh` and `git` (the CLI). |
| `scripts/release/set-version.mjs` | Writes a version into every file that carries it (`setVersion`). Replaces what `release.mjs` did. |
| `scripts/release/check-title.mjs` | The PR title check's command. |
| `scripts/release/release.test.mjs` | `node --test` suite for all of the above, including `setVersion` on a copy of the real files. `npm run test:release`. |
| `.github/workflows/app-release.yml` | Plan → build → cleanup. |
| `.github/workflows/release-bump.yml` | On publish, commits the version to `main`. |
| `.github/workflows/conventional.yml` | PR title check, and the script tests. |
| `apps/desktop/scripts/tauri-linux.sh`, `appimage-unbundle-wayland.sh`, `test-appimage.sh` | Unchanged by this system: the Linux AppImage repack and smoke test. |

### The planner

`plan.mjs` runs first in **App release** (`plan` job, with full git history):

1. **Last release:** the newest *published, non-pre-release* GitHub release
   whose tag is exactly `app-v<major>.<minor>.<patch>` (drafts and
   pre-releases are ignored, so the baseline is what users actually have).
2. **Commits:** first-parent commits `tag..HEAD`; for each, the files changed
   against its first parent. Commits touching no app path are dropped. A kept
   commit whose title isn't conventional gets a `::warning::` and releases
   nothing.
3. **Decision**, by event:

| Event | build | publish | version |
|---|---|---|---|
| push to `main` | if any commit releases | yes | `nextVersion(last, commits)` |
| `pull_request` (`labeled`, `synchronize`) | only with the `build` label | never | the last release's (unused) |
| manual run | always | only on `main` | the input, else `nextVersion`, else next patch |

4. **Outputs:** `build`, `publish`, `version`, and `notes` (markdown, by
   section: Breaking changes, Features, Fixes, Performance, Reverts). Also a
   job summary.

If no release has ever been published, the version comes from
`apps/desktop/package.json` and no commits are considered.

Version rules (`conventional.mjs`): the base is the last release's
`major.minor.patch` (a suffix is dropped). `major` → `(M+1).0.0`, except when
`M` is 0, where it is `0.(m+1).0`; `minor` → `M.(m+1).0`; `patch` →
`M.m.(p+1)`.

### The build

If `plan.build` is true, the `build` job runs on four runners, `fail-fast`
off: macOS (universal, both targets), Windows, Linux x86_64 and Linux arm64
(both on Ubuntu 22.04 for an older glibc). In order:

1. Checkout, Linux dependencies (`squashfs-tools` is for the AppImage repack),
   Rust, **`Swatinem/rust-cache`** (key = the runner OS; `save-if` only on
   `main`), Node, `npm ci`.
2. **Set the version** (publishing runs only): `set-version.mjs <version>`
   on the checkout. It comes **after** the cache and `npm ci` on purpose: the
   cache keys hash `Cargo.lock` and `package-lock.json`, which the script
   edits, and a new version must not be a new cache.
3. **`tauri-action`** with `tauriScript` = `bash scripts/tauri-linux.sh` on
   Linux (so the AppImage loses its bundled `libwayland-*` and is re-signed
   before upload) and `npm run tauri` elsewhere. Publishing runs add
   `--config src-tauri/tauri.updater.conf.json` (signed update bundles and
   `latest.json`), `tagName: app-v<version>`, `releaseCommitish: <sha>`,
   `releaseDraft: true` and a body of the notes plus the install text.
   Non-publishing runs set no `tagName`, so nothing is released.
4. On macOS, a second identical `tauri-action` runs only if the first failed
   (`bundle_dmg.sh` flakes on GitHub's runners; the retry reuses the compiled
   app).
5. Linux: the **Arch smoke test** (`test-appimage.sh`, Docker, Xvfb) fails on a
   blank window; its screenshot is uploaded as `appimage-test-<arch>`. It runs
   after the upload, so a failure shows red but leaves the draft.
6. Non-publishing runs upload the installers as `solstice-<os>-<arch>`
   artifacts (7 days).

**Draft handling** (why it looks the way it does): `tauri-action` reuses a
draft with the same tag but never updates its notes or tag target, and a
platform that fails would leave the previous build's installers next to the
new ones. So when publishing, the `plan` job first **deletes the existing draft
of the same version**, and each build creates a fresh one at the built commit
(`releaseCommitish`). The four jobs create it as the first one finishes and the
rest upload into it; `latest.json` is merged across them. The `cleanup` job,
after a fully green build, deletes drafts of *other* `app-v*` versions (a
`fix` draft 0.9.2 superseded by a `feat` draft 0.10.0). Only drafts are ever
deleted; a published release is never touched. A draft's tag doesn't exist
until publish, so URLs in `latest.json` are built from `tagName` and are valid
once the draft is published.

### Concurrency

The group is the ref (and, for PRs, whether the event was the `build` label, so
adding an unrelated label doesn't cancel a build). On `main` runs queue and
**don't cancel** one another (GitHub keeps only the newest waiting run), so a
build in flight finishes and the draft ends at the latest merge. On PRs and
branches a new push cancels the old run.

### Publishing and the bump

Pressing Publish makes the tag `app-v<version>` at the commit that was built
(not wherever `main` has moved to). That fires `release: published`, and
**Release bump** (not for pre-releases) checks out `main` with the deploy key,
runs `set-version.mjs`, and, if anything changed, commits
`chore(release): <version> [skip ci]` and pushes (rebasing and retrying up to
three times). `[skip ci]` is required: a deploy-key push, unlike the default
token's, runs workflows, and the commit touches app paths. Its `chore` type
releases nothing, so the planner ignores it anyway.

`set-version.mjs` rewrites: `apps/desktop/package.json` (which
`tauri.conf.json` reads) and its entry in `package-lock.json`;
`apps/desktop/src-tauri/Cargo.toml` and the `solstice` entry in `Cargo.lock`;
and the iOS project (`Info.plist`, `project.yml`: iOS takes only numbers, so a
pre-release ships as its release's). The sync server (`sync-v*`, its own
workflow) and the library crates keep their own versions.

### Updater

Installed apps read `latest.json` from the newest **published** release. A
draft (or pre-release) never reaches them, so Publish is the moment of
shipping. Bundles are signed with `TAURI_SIGNING_PRIVATE_KEY` (and its
password); the public half is the `pubkey` in `tauri.conf.json`. Keep that key
backed up outside GitHub: losing it means every install must be reinstalled by
hand. macOS uses one universal bundle for both `darwin-aarch64` and
`darwin-x86_64`.

### Speed and caches

GitHub scopes caches by ref: a PR or manual run can restore its own ref's and
the default branch's, and nothing else. Before this system the workflow never
ran on `main`, so every build was cold (`No cache found.`), and tag caches
(about 650 to 790 MB per platform) were never reused. Now only `main` saves
(`save-if`), and everything restores from it.

Measured before the change, same PR ref, first push (cold) vs a later push
(warm):

| Job | Cold | Warm |
|---|---|---|
| macOS (universal) | 662–963 s | 380–390 s |
| Windows | 669–824 s | 350–385 s |
| Linux x86_64 | 402 s | 200 s |
| Linux arm64 | 571 s | 311 s |

The first build on `main` is cold. **Not yet measured** under the new flow:
expect the second releasing build on `main`, and `build`-labelled PRs, to look
like the warm column. GitHub drops caches unused for 7 days.

The default release profile is used (no LTO; there is no `[profile.release]`),
so there were no build-profile savings to take. Not done, and worth measuring
only if warm builds still feel slow: splitting the macOS universal build into
aarch64 and x86_64 jobs (it would change the shipped dmg and `latest.json`),
a faster linker, or `sccache`.

## Repository setup this relies on

Settings that live in GitHub rather than the repo. If the system misbehaves,
check these first.

| Setting | Value |
|---|---|
| Merge methods | Squash only. Commit title = **PR title**; message = **PR description**. |
| Ruleset `main` (id 26673689) | Applies to the default branch. Blocks deletion and non-fast-forward. Requires a pull request (0 approvals, squash only) and the status check **`title`** (`conventional.yml`). Bypass: repository admins, and the deploy key. |
| Deploy key `release-bump (Actions pushes the version commit)` | Write access. Its private half is the Actions secret `RELEASE_BUMP_DEPLOY_KEY`. The Actions bot can't be a ruleset bypass actor, which is why a key is used; the org has to allow deploy keys. |
| Label `build` | Builds a PR's installers. |
| Secrets | `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (updater signing); `RELEASE_BUMP_DEPLOY_KEY` (above). |

**Rotating the deploy key:** make a new ed25519 key, add its public half as a
write deploy key, `gh secret set RELEASE_BUMP_DEPLOY_KEY < key`, then delete the
old key (the ruleset's bypass entry is "DeployKey", not a specific key).

**Changing the rules:** the ruleset can be edited at Settings → Rules. If you
turn on required approvals, remember the bump push relies on the bypass.

## Known gaps

- **Not yet run end to end.** The flow was verified by unit tests, a dry run of
  the planner against the real history, YAML parsing and the PR checks; the
  `build` job, draft creation, `cleanup`, publish and **Release bump** run for
  the first time on the first releasing merge or manual run. `actionlint` was
  not run.
- A failed platform leaves an incomplete draft; nothing stops you publishing it.
- Packaging problems surface after merge unless the PR was labelled `build`.
- The bump is a direct commit to `main` by a bot; between publishing and the
  bump (about a minute) the repo's version files still show the old version.
- Non-conforming commits are skipped, not rejected, if they reach `main`
  (admins can bypass the ruleset).

## History

- 0.9.1 was built by the old tag-triggered workflow and published (not left as a
  draft) four minutes after its build finished; it is the baseline
  (`app-v0.9.1`) for "commits since".
- 2026-11-06: PR 85 replaced the tag workflow with this system; PR 86 moved the
  bump onto a deploy key; the `main` ruleset and squash-only merging followed.
