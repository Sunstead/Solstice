#!/usr/bin/env node
/**
 * Fails unless the argument is a conventional-commit title (a squash-merged
 * PR's title becomes the commit that picks the next version):
 *
 *   node scripts/release/check-title.mjs "feat(editor): wrap code lines"
 */
import { TYPES, parseCommit } from './conventional.mjs';

const title = process.argv[2] ?? '';
if (parseCommit(title)) {
  console.log(`OK: ${title}`);
} else {
  console.error(`"${title}" is not a conventional commit title.`);
  console.error('Use `type(scope)!: subject`, where the type is one of:');
  console.error(`  ${TYPES.join(', ')}`);
  console.error('feat is a minor release, fix and perf a patch, and `!` (or BREAKING CHANGE) a breaking one;');
  console.error('the rest ship in the next release without cutting one. See RELEASING.md.');
  process.exit(1);
}
