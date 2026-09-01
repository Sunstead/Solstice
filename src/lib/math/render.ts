import katex from 'katex';

import 'katex/dist/katex.min.css';

/**
 * Rendering the same formula repeatedly is common -- a decoration rebuild
 * touches every formula in the document -- and KaTeX is not cheap, so results
 * are memoized by their source.
 */
const cache = new Map<string, string>();

const MAX_CACHE = 512;

export function renderMath(source: string, displayMode: boolean): string {
  const key = `${displayMode ? 'block' : 'inline'}:${source}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  // `throwOnError: false` makes KaTeX render the offending source in its error
  // colour instead of throwing, which is the right behaviour mid-typing: a
  // half-written formula is invalid far more often than it is finished.
  const html = katex.renderToString(source, {
    displayMode,
    throwOnError: false,
    errorColor: 'var(--destructive)',
    output: 'html',
  });

  if (cache.size >= MAX_CACHE) cache.clear();
  cache.set(key, html);

  return html;
}

/**
 * Carries the formula on the rendered output, so a click on it can be matched
 * back to its source. Deliberately not the mark's own `data-math-inline`: that
 * one marks *source* text, and `mathInlineMark.parseDOM` claims any span
 * carrying it -- rendered output sharing the name would be pasted back in as
 * if the KaTeX markup were the formula.
 */
export const MATH_SOURCE_ATTRIBUTE = 'data-math-source';

/** Builds the element a decoration or node view shows. */
export function renderMathElement(
  source: string,
  displayMode: boolean,
): HTMLElement {
  const host = document.createElement(displayMode ? 'div' : 'span');
  host.className = displayMode ? 'math-block-rendered' : 'math-inline-rendered';
  host.setAttribute('data-not-typeset', '');
  // The hook the click handler uses to turn a click on rendered output back
  // into a caret position in the source behind it.
  if (!displayMode) host.setAttribute(MATH_SOURCE_ATTRIBUTE, source);
  host.innerHTML = renderMath(source, displayMode);

  return host;
}
