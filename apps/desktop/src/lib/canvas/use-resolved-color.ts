import { useEffect, useRef, useState, type RefObject } from 'react';

export interface ResolvedColors {
  /** Read during layout, same as before: a draw effect wants this value, not
   * a re-render every time the theme fires a batch of style mutations. */
  current: RefObject<Record<string, string>>['current'];
  /**
   * Bumped each time `current` is refreshed. Mutating a ref does not notify
   * anything watching it, so a draw effect that depended on the ref itself
   * (whose identity never changes) would keep painting the old colour until
   * something unrelated -- a pan, a resize -- happened to redraw it. Depend on
   * this instead of on the ref to redraw the moment a theme actually changes.
   */
  version: number;
}

/**
 * Theme colours resolved to values a `<canvas>` accepts as a fill, since it
 * cannot paint with `var(--ring)`.
 *
 * Resolving means `getComputedStyle`, which forces a style recalculation, so
 * values are cached and re-read only when the theme changes.
 *
 * @param properties CSS or custom properties, e.g. `['--canvas-color-1']`.
 */
export function useResolvedColors(
  ref: RefObject<HTMLElement | null>,
  properties: readonly string[],
): ResolvedColors {
  const resolved = useRef<Record<string, string>>({});
  const [version, setVersion] = useState(0);

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
      // The ref is already fresh by the time this schedules a render, so the
      // redraw it triggers reads the new colour rather than racing it.
      setVersion((v) => v + 1);
    };

    read();
    // Theme changes and per-token `cssVar` settings both land as `class` or
    // `style` mutations on <html> (see `lib/theme/apply.ts`); one theme swap
    // is dozens of `style.setProperty` calls, but the observer coalesces
    // everything before the next microtask into a single callback, so this
    // fires once per change, not once per variable.
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-theme'],
    });

    return () => observer.disconnect();
  }, [ref, key]);

  return { current: resolved.current, version };
}
