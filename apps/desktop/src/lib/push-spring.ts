/** Used where the stylesheet gives no spring (`--push-spring`, `app.css`). */
const FALLBACK = { ms: 500, easing: 'cubic-bezier(0.2, 0, 0, 1)' };

/** A CSS time in ms: `385ms`, or `.385s` as a minifier or WebKit writes it. */
export function cssTimeMs(raw: string): number {
  const value = raw.trim();
  return parseFloat(value) * (value.endsWith('ms') ? 1 : 1000);
}

/**
 * UINavigationController's spring, as a page pushed over another moves
 * (`--push-ms`, `--push-spring` in app.css). WebKit and the production
 * minifier hand the duration back as seconds, so it's parsed, never assumed.
 */
export function pushSpring(): { ms: number; easing: string } {
  if (typeof document === 'undefined') return FALLBACK;
  const style = getComputedStyle(document.documentElement);
  const ms = cssTimeMs(style.getPropertyValue('--push-ms'));
  const easing = style.getPropertyValue('--push-spring').trim();
  return ms && easing ? { ms, easing } : FALLBACK;
}
