#!/usr/bin/env node
/**
 * Sets a product's version in every file that carries it:
 *
 *   node scripts/release/set-version.mjs 0.10.0                 the desktop app
 *   node scripts/release/set-version.mjs --product sync 0.6.0   the sync server
 *
 * For the app: apps/desktop/package.json (tauri.conf.json reads it from there) and its
 * entry in package-lock.json, the app's crate and its entry in Cargo.lock, and
 * the iOS project's copy. For the sync server: apps/sync/Cargo.toml and its
 * entry in Cargo.lock (the server reports it at /v1/info). The library crates
 * have their own versions. Nothing is committed here: a release workflow runs
 * it on its build checkout, and commits it once the release is out.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;
/** The app's crate, as Cargo.lock names it. */
const CRATE = 'solstice';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** The version of a crate: the first `version =` line of its Cargo.toml, and its Cargo.lock entry only. */
function setCrateVersion(version, cargoPath, lockPath, crate) {
  const cargo = readFileSync(cargoPath, 'utf8');
  const bumped = cargo.replace(/^version = "[^"]*"/m, `version = "${version}"`);
  if (bumped === cargo && !cargo.includes(`version = "${version}"`)) {
    throw new Error(`could not find the version in ${path.relative(repoRoot, cargoPath)}`);
  }
  writeFileSync(cargoPath, bumped);
  const lock = readFileSync(lockPath, 'utf8');
  const entry = new RegExp(`(\\[\\[package\\]\\]\\r?\\nname = "${crate}"\\r?\\nversion = ")[^"]*(")`);
  if (!entry.test(lock)) throw new Error(`could not find ${crate} in Cargo.lock`);
  writeFileSync(lockPath, lock.replace(entry, `$1${version}$2`));
}

export function setVersion(version, root = repoRoot, product = 'app') {
  if (!SEMVER.test(version)) throw new Error(`"${version}" is not a version like 1.2.3 or 1.2.3-beta.1`);
  if (product === 'sync') {
    setCrateVersion(version, path.join(root, 'apps/sync/Cargo.toml'), path.join(root, 'Cargo.lock'), 'solstice-sync-server');
    return;
  }
  if (product !== 'app') throw new Error(`unknown product "${product}"`);
  const appDir = path.join(root, 'apps/desktop');
  const files = {
    pkg: path.join(appDir, 'package.json'),
    lock: path.join(root, 'package-lock.json'),
    cargo: path.join(appDir, 'src-tauri/Cargo.toml'),
    cargoLock: path.join(root, 'Cargo.lock'),
    iosPlist: path.join(appDir, 'src-tauri/gen/apple/solstice_iOS/Info.plist'),
    iosProject: path.join(appDir, 'src-tauri/gen/apple/project.yml'),
  };

  // apps/desktop/package.json, and its entry in the root lockfile.
  const pkg = JSON.parse(readFileSync(files.pkg, 'utf8'));
  pkg.version = version;
  writeFileSync(files.pkg, `${JSON.stringify(pkg, null, 2)}\n`);
  const lockJson = JSON.parse(readFileSync(files.lock, 'utf8'));
  if (!lockJson.packages?.['apps/desktop']) throw new Error('could not find apps/desktop in package-lock.json');
  lockJson.packages['apps/desktop'].version = version;
  writeFileSync(files.lock, `${JSON.stringify(lockJson, null, 2)}\n`);

  // The app's crate.
  setCrateVersion(version, files.cargo, files.cargoLock, CRATE);

  // The iOS project, which keeps its own copy. iOS takes only numbers, so a
  // pre-release ships as its release's.
  const ios = version.split('-')[0];
  const plist = readFileSync(files.iosPlist, 'utf8');
  const plistBumped = plist.replace(
    /(<key>(?:CFBundleShortVersionString|CFBundleVersion)<\/key>\s*<string>)[^<]*(<\/string>)/g,
    `$1${ios}$2`,
  );
  if (plistBumped === plist && !plist.includes(`<string>${ios}</string>`)) {
    throw new Error('could not find the version in the iOS Info.plist');
  }
  writeFileSync(files.iosPlist, plistBumped);
  const project = readFileSync(files.iosProject, 'utf8');
  writeFileSync(
    files.iosProject,
    project
      .replace(/(CFBundleShortVersionString: ).*/, `$1${ios}`)
      .replace(/(CFBundleVersion: ).*/, `$1"${ios}"`),
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--product');
  const product = at >= 0 ? args.splice(at, 2)[1] : 'app';
  const version = args[0]?.replace(/^v/, '');
  if (!version) {
    console.error('usage: node scripts/release/set-version.mjs [--product app|sync] <version>   e.g. 0.10.0');
    process.exit(1);
  }
  try {
    setVersion(version, repoRoot, product);
  } catch (e) {
    console.error(`set-version: ${e.message}`);
    process.exit(1);
  }
  console.log(`Set the ${product}'s version to ${version}.`);
}
