import type { CanvasColor } from './types';

/**
 * The two forms a JSON Canvas colour can take, resolved to something CSS will
 * accept.
 *
 * A preset resolves to a `var()` *reference*, not a computed value. That is
 * what makes preset colours follow the theme for free -- the same trick
 * `.solstice-canvas-grid` uses with `color: var(--ring)`. Resolving to a
 * concrete oklch here would freeze a board in whichever theme happened to be
 * active when it was rendered, and the file would still say `"4"`.
 */

/** The spec's fixed meanings for the six preset indices. */
export const CANVAS_PRESETS = [
  { value: '1', label: 'Red' },
  { value: '2', label: 'Orange' },
  { value: '3', label: 'Yellow' },
  { value: '4', label: 'Green' },
  { value: '5', label: 'Cyan' },
  { value: '6', label: 'Purple' },
] as const;

const PRESET_VALUES: readonly string[] = CANVAS_PRESETS.map((p) => p.value);

/** `#abc` and `#aabbcc`, with the 8-digit alpha forms CSS also accepts. */
const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export function isPresetColor(color: string): boolean {
  return PRESET_VALUES.includes(color);
}

/**
 * @returns A CSS colour value, or null when the document carries no colour (or
 *   one this app cannot make sense of, which is left to the caller's default
 *   rather than guessed at).
 */
export function resolveCanvasColor(color: CanvasColor | undefined): string | null {
  if (!color) return null;
  if (isPresetColor(color)) return `var(--canvas-color-${color})`;
  if (HEX.test(color)) return color;
  return null;
}
