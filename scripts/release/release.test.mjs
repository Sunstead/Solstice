import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { bumpLevel, bumpVersion, levelOf, nextVersion, parseCommit, releaseNotes } from './conventional.mjs';
import { decide, touchesApp } from './plan.mjs';
import { setVersion } from './set-version.mjs';

const c = (title, body = '') => ({ title, body });
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('parses type, scope, breaking mark and subject', () => {
  assert.deepEqual(parseCommit('feat(editor)!: wrap lines (#12)'), {
    type: 'feat',
    scope: 'editor',
    breaking: true,
    subject: 'wrap lines (#12)',
  });
  assert.equal(parseCommit('fix: a bug')?.scope, null);
  assert.equal(parseCommit('fix: a bug', 'BREAKING CHANGE: it moved')?.breaking, true);
});

test('rejects titles that are not conventional commits', () => {
  for (const t of ['Linux: fix the AppImage', 'Release Solstice 0.9.1', 'feat:no space', 'feature: x', 'Fix: capital', 'fix:', 'fix(): x', 'Merge pull request #84 from x/y']) {
    assert.equal(parseCommit(t), null, t);
  }
});

test('feat is minor, fix/perf/revert patch, breaking major, the rest nothing', () => {
  assert.equal(levelOf(parseCommit('feat: x')), 'minor');
  for (const t of ['fix', 'perf', 'revert']) assert.equal(levelOf(parseCommit(`${t}: x`)), 'patch');
  assert.equal(levelOf(parseCommit('fix!: x')), 'major');
  for (const t of ['docs', 'style', 'refactor', 'test', 'build', 'ci', 'chore']) assert.equal(levelOf(parseCommit(`${t}: x`)), null);
  assert.equal(levelOf(null), null);
});

test('the biggest bump among the commits wins, whatever the order', () => {
  assert.equal(bumpLevel([c('fix: a'), c('feat: b'), c('fix: c')]), 'minor');
  assert.equal(bumpLevel([c('feat: a'), c('fix: b', 'BREAKING CHANGE: x')]), 'major');
  assert.equal(bumpLevel([c('docs: a'), c('chore: b'), c('not conventional')]), null);
});

test('bumps versions, with a breaking change only a minor bump before 1.0', () => {
  assert.equal(bumpVersion('0.9.1', 'patch'), '0.9.2');
  assert.equal(bumpVersion('0.9.1', 'minor'), '0.10.0');
  assert.equal(bumpVersion('0.9.1', 'major'), '0.10.0');
  assert.equal(bumpVersion('1.4.2', 'major'), '2.0.0');
  assert.equal(bumpVersion('1.4.2', 'minor'), '1.5.0');
  assert.equal(bumpVersion('1.0.0-beta.2', 'patch'), '1.0.1');
  assert.equal(nextVersion('0.9.1', [c('fix: a'), c('feat: b')]), '0.10.0');
  assert.equal(nextVersion('0.9.1', [c('chore: a')]), null);
});

test('release notes group commits, and a breaking feature is listed once', () => {
  const notes = releaseNotes([
    c('feat(editor): wrap lines (#1)'),
    c('fix: save on blur (#2)'),
    c('feat!: new vault format (#3)'),
    c('docs: readme'),
    c('perf(search): index faster (#4)'),
  ]);
  assert.equal(
    notes,
    [
      '### Breaking changes',
      '- new vault format (#3)',
      '',
      '### Features',
      '- **editor:** wrap lines (#1)',
      '',
      '### Fixes',
      '- save on blur (#2)',
      '',
      '### Performance',
      '- **search:** index faster (#4)',
    ].join('\n'),
  );
  assert.equal(releaseNotes([c('docs: x')]), '');
});

test('only commits touching the app count', () => {
  assert.equal(touchesApp(['apps/desktop/src/app.tsx']), true);
  assert.equal(touchesApp(['crates/solstice-core/src/lib.rs']), true);
  assert.equal(touchesApp(['Cargo.lock']), true);
  assert.equal(touchesApp(['apps/sync/src/main.rs', 'docs/sync.md', 'RELEASING.md']), false);
});

test('a push to main releases only when the commits ask for it', () => {
  const base = { event: 'push', onMain: true, lastVersion: '0.9.1' };
  assert.deepEqual(decide({ ...base, commits: [c('fix: a')] }), {
    build: true,
    publish: true,
    version: '0.9.2',
    notes: '### Fixes\n- a',
  });
  assert.equal(decide({ ...base, commits: [c('refactor: a')] }).build, false);
  assert.equal(decide({ ...base, commits: [] }).publish, false);
});

test('a pull request builds only with the build label, and never publishes', () => {
  const base = { event: 'pull_request', onMain: false, lastVersion: '0.9.1', commits: [] };
  assert.equal(decide({ ...base, hasBuildLabel: false }).build, false);
  const labelled = decide({ ...base, hasBuildLabel: true });
  assert.equal(labelled.build, true);
  assert.equal(labelled.publish, false);
});

test('a manual run always builds, and publishes only from main', () => {
  const base = { event: 'workflow_dispatch', lastVersion: '0.9.1', commits: [] };
  assert.equal(decide({ ...base, onMain: true }).version, '0.9.2');
  assert.equal(decide({ ...base, onMain: true, commits: [c('feat: a')] }).version, '0.10.0');
  assert.equal(decide({ ...base, onMain: true, inputVersion: 'v1.0.0' }).version, '1.0.0');
  assert.equal(decide({ ...base, onMain: false, inputVersion: '1.0.0' }).publish, false);
  assert.equal(decide({ ...base, onMain: true, inputVersion: '0.10.0-beta.1' }).version, '0.10.0-beta.1');
  assert.throws(() => decide({ ...base, onMain: true, inputVersion: '0.9.1' }), /not newer/);
  assert.throws(() => decide({ ...base, onMain: true, inputVersion: 'nope' }), /not a version/);
});

test('set-version rewrites every file that carries the version, and nothing else', () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'set-version-'));
  const copy = ['apps/desktop/package.json', 'package-lock.json', 'apps/desktop/src-tauri/Cargo.toml', 'Cargo.lock', 'apps/desktop/src-tauri/gen/apple/solstice_iOS/Info.plist', 'apps/desktop/src-tauri/gen/apple/project.yml'];
  for (const f of copy) {
    cpSync(path.join(repo, f), path.join(tmp, f), { recursive: true });
  }
  setVersion('9.8.7', tmp);
  const read = (f) => readFileSync(path.join(tmp, f), 'utf8');
  assert.equal(JSON.parse(read('apps/desktop/package.json')).version, '9.8.7');
  assert.equal(JSON.parse(read('package-lock.json')).packages['apps/desktop'].version, '9.8.7');
  assert.match(read('apps/desktop/src-tauri/Cargo.toml'), /^version = "9\.8\.7"/m);
  assert.match(read('Cargo.lock'), /name = "solstice"\r?\nversion = "9\.8\.7"/);
  assert.match(read('apps/desktop/src-tauri/gen/apple/solstice_iOS/Info.plist'), /<string>9\.8\.7<\/string>/);
  // Dependencies' versions in Cargo.lock are untouched.
  const before = readFileSync(path.join(repo, 'Cargo.lock'), 'utf8').split('\n').length;
  assert.equal(read('Cargo.lock').split('\n').length, before);
  assert.throws(() => setVersion('1.2', tmp), /not a version/);
});
