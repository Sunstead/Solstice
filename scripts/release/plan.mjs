#!/usr/bin/env node
/**
 * Decides what the App release workflow does, from the commits on `main`
 * since the newest published release. Writes build, publish, version and
 * notes to $GITHUB_OUTPUT (stdout when run by hand):
 *
 *   GH_TOKEN=... GITHUB_EVENT_NAME=push GITHUB_REF=refs/heads/main \
 *     node scripts/release/plan.mjs
 *
 * Environment: PRODUCT (`app`, the default, or `sync`), GITHUB_EVENT_NAME,
 * GITHUB_REF, PR_HAS_BUILD_LABEL ("true" on a pull request labelled `build`),
 * INPUT_VERSION (a manual run's override).
 *
 * The app's last release is its newest published GitHub release; the sync
 * server has no GitHub Releases (the app's updater reads the newest one), so
 * its last release is its newest `sync-v*` tag.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { SEMVER } from './set-version.mjs';
import { bumpVersion, nextVersion, parseCommit, levelOf, releaseNotes } from './conventional.mjs';
import { PRODUCTS, touches } from './products.mjs';

const triple = (v) => v.split('-')[0].split('.').map(Number);
function newer(a, b) {
  const [x, y] = [triple(a), triple(b)];
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

/**
 * @param {object} i
 * @param {'push' | 'pull_request' | 'workflow_dispatch'} i.event
 * @param {boolean} i.onMain          the run is on refs/heads/main
 * @param {boolean} [i.hasBuildLabel] a pull request carries the `build` label
 * @param {string} [i.inputVersion]   a manual run's version override
 * @param {string} i.lastVersion      the newest published release's version
 * @param {{title: string, body?: string}[]} i.commits  app commits since it
 * @returns {{build: boolean, publish: boolean, version: string, notes: string}}
 */
export function decide({ event, onMain, hasBuildLabel = false, inputVersion = '', lastVersion, commits }) {
  const notes = releaseNotes(commits) || 'No user-facing changes.';
  if (event === 'pull_request') {
    // A check build: never published, so no version of its own.
    return { build: hasBuildLabel, publish: false, version: lastVersion, notes };
  }
  const computed = nextVersion(lastVersion, commits);
  if (event === 'push') {
    return { build: Boolean(computed), publish: Boolean(computed) && onMain, version: computed ?? lastVersion, notes };
  }
  // A manual run always builds: the override, else what the commits ask for,
  // else the next patch.
  let version = inputVersion.replace(/^v/, '');
  if (version) {
    if (!SEMVER.test(version)) throw new Error(`"${version}" is not a version like 1.2.3 or 1.2.3-beta.1`);
    if (!newer(version, lastVersion) && !(version.includes('-') && triple(version).join() === triple(lastVersion).join())) {
      throw new Error(`${version} is not newer than the published ${lastVersion}`);
    }
  } else {
    version = computed ?? bumpVersion(lastVersion, 'patch');
  }
  return { build: true, publish: onMain, version, notes };
}

function sh(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
}

/** The newest published, non-pre-release release of `product`: { tag, version }. */
function lastPublished(product) {
  const { tagPrefix } = PRODUCTS[product];
  const exact = new RegExp(`^${tagPrefix}\\d+\\.\\d+\\.\\d+$`);
  const tags =
    product === 'app'
      ? JSON.parse(sh('gh', ['release', 'list', '--exclude-drafts', '--limit', '200', '--json', 'tagName,isPrerelease']))
          .filter((r) => !r.isPrerelease)
          .map((r) => r.tagName)
      : sh('git', ['tag', '--list', `${tagPrefix}*`]).split('\n');
  const found = tags
    .filter((t) => exact.test(t))
    .map((t) => ({ tag: t, version: t.slice(tagPrefix.length) }))
    .sort((a, b) => (newer(a.version, b.version) ? -1 : 1));
  return found[0] ?? null;
}

/** First-parent commits since `tag` that touch `product`. */
function commitsSince(product, tag) {
  const log = sh('git', ['log', '--first-parent', '--reverse', '--format=%H%x1f%s%x1f%b%x1e', `${tag}..HEAD`]);
  const commits = [];
  for (const entry of log.split('\x1e')) {
    if (!entry.trim()) continue;
    const [sha, title, body] = entry.trim().split('\x1f');
    const files = sh('git', ['diff', '--name-only', `${sha}^`, sha]).split('\n').filter(Boolean);
    if (!touches(product, files)) continue;
    if (!parseCommit(title, body)) console.log(`::warning::Not a conventional commit, so it can't release: ${title} (${sha.slice(0, 7)})`);
    commits.push({ title, body: body ?? '' });
  }
  return commits;
}

/** The sync protocol the server speaks and the app's client expects. */
function syncProtocol(root) {
  const src = readFileSync(path.join(root, 'crates/solstice-sync/src/protocol.rs'), 'utf8');
  return /pub const PROTOCOL: u16 = (\d+);/.exec(src)?.[1] ?? '';
}

function main() {
  const product = process.env.PRODUCT || 'app';
  if (!PRODUCTS[product]) throw new Error(`unknown product "${product}"`);
  const event = process.env.GITHUB_EVENT_NAME ?? 'workflow_dispatch';
  const onMain = process.env.GITHUB_REF === 'refs/heads/main';
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

  let last = null;
  let commits = [];
  if (event !== 'pull_request') {
    last = lastPublished(product);
    if (last) commits = commitsSince(product, last.tag);
  }
  const lastVersion =
    last?.version ??
    (product === 'app'
      ? JSON.parse(readFileSync(path.join(root, 'apps/desktop/package.json'), 'utf8')).version
      : /^version = "([^"]*)"/m.exec(readFileSync(path.join(root, 'apps/sync/Cargo.toml'), 'utf8'))[1]);

  const plan = decide({
    event,
    onMain,
    hasBuildLabel: process.env.PR_HAS_BUILD_LABEL === 'true',
    inputVersion: process.env.INPUT_VERSION ?? '',
    lastVersion,
    commits,
  });

  const releasing = commits.filter((c) => levelOf(parseCommit(c.title, c.body)));
  console.log(`${product}: last published ${last ? last.tag : '(none)'}; ${commits.length} commit(s) touching it since, ${releasing.length} releasing.`);
  console.log(`build=${plan.build} publish=${plan.publish} version=${plan.version}`);

  const out = process.env.GITHUB_OUTPUT;
  const lines = [`build=${plan.build}`, `publish=${plan.publish}`, `version=${plan.version}`, `protocol=${syncProtocol(root)}`, 'notes<<NOTES_EOF', plan.notes, 'NOTES_EOF'];
  if (out) appendFileSync(out, `${lines.join('\n')}\n`);
  else console.log(lines.join('\n'));

  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    appendFileSync(
      summary,
      `### Release plan (${product})\n\n${plan.build ? `Building **${plan.version}**${plan.publish ? ' as a draft release' : ' (not published)'}.` : 'Nothing to release.'}\n\n${plan.notes}\n`,
    );
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    console.error(`plan: ${e.message}`);
    process.exit(1);
  }
}
