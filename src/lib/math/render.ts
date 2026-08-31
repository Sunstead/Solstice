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
  if (!displayMode) host.setAttribute('data-math-inline', source);
  host.innerHTML = renderMath(source, displayMode);

  return host;
}
