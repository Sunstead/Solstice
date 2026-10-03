/**
 * The inline form, as a regex, for scanning the document.
 *
 * It has to agree exactly with `tokenizeMathInline` in `./syntax`, or a
 * formula would parse from disk but never decorate (or the reverse):
 *  - neither marker may touch whitespace on the inside;
 *  - the body is non-empty and single-line;
 *  - a doubled `$` on either end belongs to the block form, not this one.
 */
export const MATH_INLINE_SOURCE = String.raw`(?<!\$)\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\$)`;

export const MATH_DELIMITER = '$';
