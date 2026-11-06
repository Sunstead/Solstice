/**
 * Conventional commits, as the app's releases use them. A squash-merged PR's
 * title is its commit, so `type(scope)!: subject` decides the next version:
 *
 *   feat                    minor
 *   fix, perf, revert       patch
 *   `!` or BREAKING CHANGE  major (minor while 0.x, where feat is already minor)
 *   docs, style, refactor, test, build, ci, chore   no release
 */

export const TYPES = ['feat', 'fix', 'perf', 'revert', 'docs', 'style', 'refactor', 'test', 'build', 'ci', 'chore'];

const TITLE = /^([a-z]+)(?:\(([^()\s][^()]*)\))?(!)?: (\S.*)$/;
const BREAKING_FOOTER = /^BREAKING[ -]CHANGE: /m;
const RANK = { patch: 1, minor: 2, major: 3 };

/**
 * @param {string} title
 * @param {string} [body]
 * @returns {{type: string, scope: string | null, breaking: boolean, subject: string} | null}
 *   null when the title isn't a conventional commit of a known type
 */
export function parseCommit(title, body = '') {
  const m = TITLE.exec(title.trim());
  if (!m || !TYPES.includes(m[1])) return null;
  return {
    type: m[1],
    scope: m[2] ?? null,
    breaking: m[3] === '!' || BREAKING_FOOTER.test(body),
    subject: m[4],
  };
}

/** The bump a parsed commit asks for, or null when it doesn't release. */
export function levelOf(commit) {
  if (!commit) return null;
  if (commit.breaking) return 'major';
  if (commit.type === 'feat') return 'minor';
  if (commit.type === 'fix' || commit.type === 'perf' || commit.type === 'revert') return 'patch';
  return null;
}

/** The biggest bump among commits ({ title, body }), or null when none releases. */
export function bumpLevel(commits) {
  let best = null;
  for (const c of commits) {
    const level = levelOf(parseCommit(c.title, c.body));
    if (level && (!best || RANK[level] > RANK[best])) best = level;
  }
  return best;
}

/** `current` bumped by `level`. A pre-release suffix on `current` is dropped. */
export function bumpVersion(current, level) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(current);
  if (!m) throw new Error(`"${current}" is not a version`);
  const [major, minor, patch] = m.slice(1).map(Number);
  // Before 1.0 a breaking change is a minor bump, since features are too.
  const effective = level === 'major' && major === 0 ? 'minor' : level;
  if (effective === 'major') return `${major + 1}.0.0`;
  if (effective === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/** The next version from the commits since `current`, or null when none releases. */
export function nextVersion(current, commits) {
  const level = bumpLevel(commits);
  return level ? bumpVersion(current, level) : null;
}

const SECTIONS = [
  ['Breaking changes', (c) => c.breaking],
  ['Features', (c) => c.type === 'feat'],
  ['Fixes', (c) => c.type === 'fix'],
  ['Performance', (c) => c.type === 'perf'],
  ['Reverts', (c) => c.type === 'revert'],
];

/**
 * Markdown release notes: one bullet per releasing commit, in the first section
 * it belongs to (a breaking feature is listed under Breaking changes only).
 */
export function releaseNotes(commits) {
  const parsed = commits
    .map((c) => parseCommit(c.title, c.body))
    .filter((c) => levelOf(c));
  const placed = new Set();
  const out = [];
  for (const [heading, match] of SECTIONS) {
    const items = parsed.filter((c) => !placed.has(c) && match(c));
    if (!items.length) continue;
    items.forEach((c) => placed.add(c));
    out.push(`### ${heading}`, ...items.map((c) => `- ${c.scope ? `**${c.scope}:** ` : ''}${c.subject}`), '');
  }
  return out.join('\n').trim();
}
