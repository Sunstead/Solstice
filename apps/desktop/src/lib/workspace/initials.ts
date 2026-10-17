/**
 * The letters on a workspace's icon: one word's first letter (School → S),
 * else the first letters of the first two words (Business Meetings → BM).
 * Spaces, `-`, `_`, `.` and camelCase break words. Unlike `lib/initials.ts`
 * (a person: first and last), the first two words name a workspace best.
 */
export function workspaceInitials(name: string): string {
  const words = name
    // A capital that starts a lowercase run after a lowercase letter or digit
    // starts a word (ProjectAtlas), so iOS stays one.
    .replace(/(?<=[\p{Ll}\p{N}])(?=\p{Lu}\p{Ll})/gu, ' ')
    .split(/[\s._-]+/u)
    .filter(Boolean);
  if (words.length === 0) return '?';
  return words
    .slice(0, 2)
    .map((word) => firstCharacter(word).toUpperCase())
    .join('');
}

/**
 * A whole character: a letter with its accents, or an emoji with its skin
 * tone, joined parts or flag pair (Intl.Segmenter is past the ES2020 lib).
 */
const FIRST_CHARACTER =
  /^(?:\p{RI}\p{RI}|\P{M}(?:\p{M}|\u{FE0F}|\p{Emoji_Modifier}|\u200d\P{M})*)/u;

function firstCharacter(text: string): string {
  return FIRST_CHARACTER.exec(text)?.[0] ?? '';
}
