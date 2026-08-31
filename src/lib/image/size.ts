/**
 * Obsidian writes an image's display size into its alt text after a pipe --
 * `![Diagram|400](diagram.png)`, or `![Diagram|400x300](...)` for both axes.
 *
 * CommonMark already parses that as ordinary alt text, so no syntax extension
 * is needed: the size is split off on the way into the schema and joined back
 * on the way out. Owning both halves here is what keeps the round trip exact.
 */

/**
 * The one place the convention is spelled out. Greedy on the left so an alt
 * text that itself contains a pipe keeps everything before the *last* one.
 */
const SIZE_SOURCE = /^(.*)\|(\d+)(?:x(\d+))?$/;

export interface ImageSize {
  alt: string;
  width: number | null;
  height: number | null;
}

/**
 * Splits `Diagram|400x300` into its parts. An alt text with no trailing size
 * is returned untouched.
 *
 * An alt text that genuinely ends in `|123` is read as a size. That ambiguity
 * is inherent to the convention rather than to this implementation, and it
 * round-trips either way -- the text is rewritten exactly as it was found.
 */
export function splitAltSize(raw: string): ImageSize {
  const match = SIZE_SOURCE.exec(raw);
  if (!match) return { alt: raw, width: null, height: null };

  return {
    alt: match[1],
    width: Number(match[2]),
    height: match[3] === undefined ? null : Number(match[3]),
  };
}

/** Inverse of `splitAltSize`. A null width means the alt text carries no size. */
export function joinAltSize(
  alt: string,
  width: number | null,
  height: number | null,
): string {
  if (width === null) return alt;

  return height === null ? `${alt}|${width}` : `${alt}|${width}x${height}`;
}

/**
 * The embed form carries its size after a pipe with nothing else attached
 * (`![[diagram.png|400x300]]`), so it needs the same grammar without the alt
 * text in front of it.
 */
const SIZE_ONLY = /^(\d+)(?:x(\d+))?$/;

export function parseSize(raw: string | null): {
  width: number | null;
  height: number | null;
} {
  const match = raw === null ? null : SIZE_ONLY.exec(raw.trim());
  if (!match) return { width: null, height: null };

  return {
    width: Number(match[1]),
    height: match[2] === undefined ? null : Number(match[2]),
  };
}
