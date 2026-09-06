import type { CanvasColor } from './types';

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

function isPresetColor(color: string): boolean {
  return PRESET_VALUES.includes(color);
}

/**
 * A JSON Canvas colour as something CSS accepts, or null when there is none (or
 * one this app cannot parse, left to the caller's default).
 *
 * Presets resolve to a `var()` reference, not a computed value, so they follow
 * the theme without the file ever being rewritten.
 */
export function resolveCanvasColor(color: CanvasColor | undefined): string | null {
  if (!color) return null;
  if (isPresetColor(color)) return `var(--canvas-color-${color})`;
  if (HEX.test(color)) return color;
  return null;
}
