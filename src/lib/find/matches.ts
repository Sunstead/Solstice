import type { Node as ProseNode } from '@milkdown/kit/prose/model';

export type FindMatch = { from: number; to: number };

export type FindOptions = {
  caseSensitive: boolean;
  wholeWord: boolean;
};

/**
 * A word character for whole-word purposes. Deliberately unicode-aware rather
 * than `\w`, so accented and non-Latin words are not treated as a string of
 * separate "words" that no whole-word search can ever match.
 */
const WORD = /[\p{L}\p{N}_]/u;

function isWordBoundary(text: string, index: number) {
  const character = text[index];
  return character === undefined || !WORD.test(character);
}

/**
 * Flattens the document into one string with a document position per
 * character, so a match found by plain string search maps straight back to a
 * ProseMirror range. Block boundaries become a single separator character:
 * without one, the end of a paragraph and the start of the next would form a
 * word that exists nowhere on screen.
 */
function flatten(doc: ProseNode) {
  let text = '';
  const positions: number[] = [];

  doc.descendants((node, position) => {
    if (node.isText) {
      const value = node.text ?? '';
      for (let index = 0; index < value.length; index += 1) {
        text += value[index];
        positions.push(position + index);
      }
      return false;
    }

    if (node.isBlock && text.length > 0 && text[text.length - 1] !== '\n') {
      text += '\n';
      positions.push(position);
    }

    return true;
  });

  return { text, positions };
}

export function findMatches(
  doc: ProseNode,
  query: string,
  { caseSensitive, wholeWord }: FindOptions,
): FindMatch[] {
  if (!query) return [];

  const { text, positions } = flatten(doc);
  const haystack = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();

  const matches: FindMatch[] = [];
  let index = haystack.indexOf(needle);

  while (index !== -1) {
    const end = index + needle.length;

    const boundedByWords =
      !wholeWord ||
      (isWordBoundary(text, index - 1) && isWordBoundary(text, end));

    // A match spanning the synthetic block separator does not exist as
    // contiguous text anywhere, so it can never be highlighted honestly.
    const withinOneBlock = !haystack.slice(index, end).includes('\n');

    if (boundedByWords && withinOneBlock) {
      matches.push({
        from: positions[index],
        to: positions[end - 1] + 1,
      });
    }

    index = haystack.indexOf(needle, index + 1);
  }

  return matches;
}
