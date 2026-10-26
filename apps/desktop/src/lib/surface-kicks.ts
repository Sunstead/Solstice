import { useCallback } from 'react';

/**
 * Every open native view's `follow` (`lib/native-surfaces.ts`), and the web
 * content over them, kept apart so what moves them (a pushed page's slide)
 * or floats over them can say so without loading the native side.
 */
export const kicks = new Set<() => void>();
export const overSurface = new Set<Element>();

/** Something moved the surfaces in a way `follow` doesn't watch: measure them again for a few frames. */
export function kickSurfaces() {
  kicks.forEach((kick) => kick());
}

/**
 * For web content in the page that floats over a surface (the find bar):
 * touches on it stay the webview's.
 */
export function useOverSurface() {
  return useCallback((el: HTMLElement | null) => {
    if (!el) return;
    overSurface.add(el);
    kickSurfaces();
    return () => {
      overSurface.delete(el);
      kickSurfaces();
    };
  }, []);
}
