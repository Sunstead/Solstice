/**
 * Every open native view's `follow` (`lib/native-surfaces.ts`), kept apart so
 * what moves them without resizing or scrolling anything (a pushed page's
 * slide) can wake them without loading the native side.
 */
export const kicks = new Set<() => void>();

/** Something moved the surfaces in a way `follow` doesn't watch: measure them again for a few frames. */
export function kickSurfaces() {
  kicks.forEach((kick) => kick());
}
