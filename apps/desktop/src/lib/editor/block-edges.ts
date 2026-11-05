import type { Command } from '@milkdown/kit/prose/state';

// Placeholder: lets the tests run before the rules are written.
export function leaveBlock(_pos: number, _dir: -1 | 1): Command {
  return () => false;
}
