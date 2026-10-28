import { useSetting } from '@/lib/settings/store';

/**
 * How an ink's color looks on the paper. PencilKit draws black ink white on
 * dark paper and white ink black (`Paper.swift`), so the tools show it that
 * way too; the color kept and sent is always the true one.
 */
export function paperColor(color: string, dark: boolean): string {
  if (!dark) return color;
  const hex = color.toLowerCase();
  if (hex === '#000000') return '#ffffff';
  if (hex === '#ffffff') return '#000000';
  return color;
}

/** `paperColor` for the paper in use (`ink.darkPaper`). */
export function usePaperColor(): (color: string) => string {
  const dark = useSetting('ink.darkPaper');
  return (color) => paperColor(color, dark);
}
