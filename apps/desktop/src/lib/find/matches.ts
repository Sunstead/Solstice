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
 * One string with a source position per character.
 *
 * `positions[i]` is wherever character `i` came from, so a match found by
 * plain string search maps straight back into whatever produced the text --
 * a ProseMirror document here, a PDF page's text items elsewhere.
 */
export type FlatText<P> = { text: string; positions: P[] };

/**
 * Flattens the document into one string with a document position per
 * character. Block boundaries become a single separator character: without
 * one, the end of a paragraph and the start of the next would form a word that
 * exists nowhere on screen.
 */
function flatten(doc: ProseNode): FlatText<number> {
  let text = '';
  const positions: number[] = [];

  doc.descendants((node, position) => {
    // Code blocks render as a CodeMirror instance, which owns its own DOM and
    // has no ProseMirror positions to hang a highlight on. Matching inside one
    // would step the selection to a match that is never drawn, so they are
    // skipped here and searched with CodeMirror's own panel instead.
    if (node.type.spec.code) return false;

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

/**
 * The search itself, over flattened text.
 *
 * Split out from `findMatches` so the PDF viewer can search a page's text
 * layer with exactly the same semantics the editor has -- the unicode word
 * boundaries and the separator rule below are the behaviour users would
 * otherwise have to learn twice.
 *
 * Returns index pairs into `positions`; mapping those back to whatever the
 * positions mean is the caller's job.
 */
export function searchFlat<P>(
  { text, positions }: FlatText<P>,
  query: string,
  { caseSensitive, wholeWord }: FindOptions,
): { start: number; end: number }[] {
  if (!query) return [];

  const haystack = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();

  const found: { start: number; end: number }[] = [];
  let index = haystack.indexOf(needle);

  while (index !== -1) {
    const end = index + needle.length;

    const boundedByWords =
      !wholeWord ||
      (isWordBoundary(text, index - 1) && isWordBoundary(text, end));

    // A match spanning the synthetic block separator does not exist as
    // contiguous text anywhere, so it can never be highlighted honestly.
    const withinOneBlock = !haystack.slice(index, end).includes('\n');

    if (boundedByWords && withinOneBlock && index < positions.length) {
      found.push({ start: index, end });
    }

    index = haystack.indexOf(needle, index + 1);
  }

  return found;
}

export function findMatches(
  doc: ProseNode,
  query: string,
  options: FindOptions,
): FindMatch[] {
  const flat = flatten(doc);

  return searchFlat(flat, query, options).map(({ start, end }) => ({
    from: flat.positions[start],
    to: flat.positions[end - 1] + 1,
  }));
}
