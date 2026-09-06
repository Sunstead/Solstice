import { useEffect, useRef, type RefObject } from 'react';

/**
 * Theme colours resolved to values a `<canvas>` accepts as a fill, since it
 * cannot paint with `var(--ring)`.
 *
 * Resolving means `getComputedStyle`, which forces a style recalculation, so
 * values are cached and re-read only when the theme changes. A ref rather than
 * state: a draw effect reads it during layout, and re-rendering would put a
 * paint between the colour changing and the canvas being redrawn.
 *
 * @param properties CSS or custom properties, e.g. `['--canvas-color-1']`.
 */
export function useResolvedColors(
  ref: RefObject<HTMLElement | null>,
  properties: readonly string[],
): RefObject<Record<string, string>> {
  const resolved = useRef<Record<string, string>>({});

  // The list is almost always a literal, so comparing contents rather than
  // identity keeps this effect from re-running on every render.
  const key = properties.join(',');

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const read = () => {
      const style = getComputedStyle(element);
      const next: Record<string, string> = {};
      for (const property of key.split(',')) {
        next[property] = property.startsWith('--')
          ? style.getPropertyValue(property).trim()
          : style.getPropertyValue(property);
      }
      resolved.current = next;
    };

    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-theme'],
    });

    return () => observer.disconnect();
  }, [ref, key]);

  return resolved;
}
