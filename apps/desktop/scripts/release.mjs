#!/usr/bin/env node
/**
 * Cuts a Solstice desktop release: sets the app's version, commits, and tags
 * `app-v<version>`, which builds the installers
 * (.github/workflows/app-release.yml). Ported from Cosmos's.
 *
 *   npm run release:app -- 0.2.0          bump, commit and tag locally
 *   npm run release:app -- 0.2.0 --push   ...and push the commit and the tag
 *
 * The version lives in apps/desktop/package.json (tauri.conf.json reads it
 * from there) and the app's crate, apps/desktop/src-tauri/Cargo.toml, kept in
 * step here. The sync server (`sync-v*`) and the library crates have their
 * own versions.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(appDir, '../..');
const files = {
  pkg: path.join(appDir, 'package.json'),
  lock: path.join(root, 'package-lock.json'),
  cargo: path.join(appDir, 'src-tauri/Cargo.toml'),
  cargoLock: path.join(root, 'Cargo.lock'),
};
/** The app's crate, as Cargo.lock names it. */
const CRATE = 'solstice';

const git = (...args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const fail = (msg) => {
  console.error(`release: ${msg}`);
  process.exit(1);
};

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/** Negative when a < b. Pre-releases sort before their release. */
function compare(a, b) {
  const [, ...pa] = a.match(SEMVER);
  const [, ...pb] = b.match(SEMVER);
  for (let i = 0; i < 3; i += 1) {
    const d = Number(pa[i]) - Number(pb[i]);
    if (d) return d;
  }
  if (pa[3] === pb[3]) return 0;
  if (!pa[3]) return 1;
  if (!pb[3]) return -1;
  return pa[3] < pb[3] ? -1 : 1;
}

const args = process.argv.slice(2);
const push = args.includes('--push');
const version = args.find((a) => !a.startsWith('--'))?.replace(/^v/, '');

if (!version) fail('usage: npm run release:app -- <version> [--push]   e.g. 0.2.0 or 0.2.0-beta.1');
if (!SEMVER.test(version)) fail(`"${version}" is not a version like 1.2.3 or 1.2.3-beta.1`);

const tag = `app-v${version}`;
const current = JSON.parse(readFileSync(files.pkg, 'utf8')).version;

// Preconditions, all checked before anything is written.
const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
if (branch !== 'main') fail(`releases are cut from main, not ${branch}`);
if (git('status', '--porcelain', '--untracked-files=no')) {
  fail('commit or stash your changes first; the release commit should only bump the version');
}
git('fetch', '--quiet', '--tags', 'origin');
if (git('rev-list', '--count', 'HEAD..origin/main') !== '0') fail('main is behind origin/main; pull first');
if (git('tag', '--list', tag)) fail(`${tag} already exists`);
if (compare(version, current) <= 0) fail(`${version} is not newer than the current ${current}`);

// apps/desktop/package.json, and its entry in the root lockfile.
const pkg = JSON.parse(readFileSync(files.pkg, 'utf8'));
pkg.version = version;
writeFileSync(files.pkg, `${JSON.stringify(pkg, null, 2)}\n`);
const lockJson = JSON.parse(readFileSync(files.lock, 'utf8'));
if (!lockJson.packages?.['apps/desktop']) fail('could not find apps/desktop in package-lock.json');
lockJson.packages['apps/desktop'].version = version;
writeFileSync(files.lock, `${JSON.stringify(lockJson, null, 2)}\n`);

// The crate: its [package] version is the first `version =` line. In
// Cargo.lock, rewrite only its entry, never a dependency's.
const cargo = readFileSync(files.cargo, 'utf8');
const bumped = cargo.replace(/^version = "[^"]*"/m, `version = "${version}"`);
if (bumped === cargo) fail('could not find the version in apps/desktop/src-tauri/Cargo.toml');
writeFileSync(files.cargo, bumped);
const lock = readFileSync(files.cargoLock, 'utf8');
const entry = new RegExp(`(\\[\\[package\\]\\]\\r?\\nname = "${CRATE}"\\r?\\nversion = ")[^"]*(")`);
if (!entry.test(lock)) fail(`could not find ${CRATE} in Cargo.lock`);
writeFileSync(files.cargoLock, lock.replace(entry, `$1${version}$2`));

git('add', files.pkg, files.lock, files.cargo, files.cargoLock);
git('commit', '--quiet', '-m', `Release Solstice ${version}`);
git('tag', '-a', tag, '-m', `Solstice ${version}`);
console.log(`Bumped ${current} -> ${version}, committed and tagged ${tag}.`);

if (push) {
  git('push', '--quiet', 'origin', 'main');
  git('push', '--quiet', 'origin', tag);
  console.log('Pushed. Building a draft release:');
  console.log('  https://github.com/Sunstead/Solstice/actions/workflows/app-release.yml');
} else {
  console.log('Nothing pushed. When ready:');
  console.log(`  git push origin main && git push origin ${tag}`);
  console.log('To undo instead:');
  console.log(`  git tag -d ${tag} && git reset --hard HEAD~1`);
}
