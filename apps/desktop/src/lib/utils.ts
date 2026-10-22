import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function toPx(value: string): number {
  if (value.endsWith("rem")) {
    const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
    return parseFloat(value) * rootFontSize
  }
  if (value.endsWith("px")) {
    return parseFloat(value)
  }
  // fallback: just strip units and hope for the best
  return parseFloat(value)
}

export function getFileExtension(filename: string): string {
  const lastDotIndex = filename.lastIndexOf('.');
  
  // Return empty string if no dot exists or if it's a hidden file like ".htaccess"
  if (lastDotIndex <= 0) {
    return '';
  }
  
  return filename.substring(lastDotIndex + 1);
}
/**
 * What kind of file a name is, out of `known`: a two-part extension
 * (`drawing.svg`, `task.md`) where one fits, else its last.
 */
export function typeExtension(filename: string, known: Iterable<string>): string {
  const lower = filename.toLowerCase();
  let best = '';
  for (const extension of known) {
    if (!extension.includes('.') || extension.length <= best.length) continue;
    if (lower.length > extension.length + 1 && lower.endsWith(`.${extension}`)) best = extension;
  }
  return best || getFileExtension(filename);
}
