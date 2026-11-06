#!/usr/bin/env node
/**
 * Sets the desktop app's version in every file that carries it:
 *
 *   node scripts/release/set-version.mjs 0.10.0
 *
 * apps/desktop/package.json (tauri.conf.json reads it from there) and its
 * entry in package-lock.json, the app's crate and its entry in Cargo.lock, and
 * the iOS project's copy. The sync server (`sync-v*`) and the library crates
 * have their own versions. Nothing is committed here: the release workflow
 * runs it on its build checkout, and the release-bump workflow commits it
 * once a release is published.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;
/** The app's crate, as Cargo.lock names it. */
const CRATE = 'solstice';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function setVersion(version, root = repoRoot) {
  if (!SEMVER.test(version)) throw new Error(`"${version}" is not a version like 1.2.3 or 1.2.3-beta.1`);
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

  // The crate: its [package] version is the first `version =` line. In
  // Cargo.lock, rewrite only its entry, never a dependency's.
  const cargo = readFileSync(files.cargo, 'utf8');
  const bumped = cargo.replace(/^version = "[^"]*"/m, `version = "${version}"`);
  if (bumped === cargo && !cargo.includes(`version = "${version}"`)) {
    throw new Error('could not find the version in apps/desktop/src-tauri/Cargo.toml');
  }
  writeFileSync(files.cargo, bumped);
  const lock = readFileSync(files.cargoLock, 'utf8');
  const entry = new RegExp(`(\\[\\[package\\]\\]\\r?\\nname = "${CRATE}"\\r?\\nversion = ")[^"]*(")`);
  if (!entry.test(lock)) throw new Error(`could not find ${CRATE} in Cargo.lock`);
  writeFileSync(files.cargoLock, lock.replace(entry, `$1${version}$2`));

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
  const version = process.argv[2]?.replace(/^v/, '');
  if (!version) {
    console.error('usage: node scripts/release/set-version.mjs <version>   e.g. 0.10.0');
    process.exit(1);
  }
  try {
    setVersion(version);
  } catch (e) {
    console.error(`set-version: ${e.message}`);
    process.exit(1);
  }
  console.log(`Set the app's version to ${version}.`);
}
