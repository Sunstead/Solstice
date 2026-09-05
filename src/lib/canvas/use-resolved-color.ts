import { useEffect, useRef, type RefObject } from 'react';

/**
 * Theme colours resolved to values a `<canvas>` will accept as a fill.
 *
 * A canvas cannot paint with `var(--ring)`; it needs a concrete colour. Reading
 * one means `getComputedStyle`, which forces a style recalculation -- far too
 * expensive to do inside a draw that runs every frame -- so the values are
 * cached in a ref and re-read only when the theme actually changes, which shows
 * up as an attribute change on `<html>`.
 *
 * Returns a ref rather than state on purpose: a draw effect reads it during
 * layout, and making this a re-render would put a paint between the colour
 * changing and the canvas being redrawn.
 *
 * @param properties CSS properties or custom properties to resolve, e.g.
 *   `['color']` or `['--canvas-color-1', '--muted-foreground']`.
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
