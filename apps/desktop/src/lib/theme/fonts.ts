import { commands } from '@/lib/backend';

export type FontKind = 'sans' | 'serif' | 'mono';

export interface BundledFont {
  /** The family name as the `@font-face` declares it. */
  family: string;
  label: string;
  kind: FontKind;
}

/**
 * Faces shipped with the app, imported in `styles/app.css`. They exist so the
 * font pickers have good answers before the user goes looking through their
 * own library, and so a workspace opened on a machine without them still
 * renders the way it was set up.
 */
export const bundledFonts: BundledFont[] = [
  { family: 'Geist Variable', label: 'Geist', kind: 'sans' },
  { family: 'Inter Variable', label: 'Inter', kind: 'sans' },
  { family: 'Literata Variable', label: 'Literata', kind: 'serif' },
  { family: 'JetBrains Mono Variable', label: 'JetBrains Mono', kind: 'mono' },
];

const GENERIC: Record<FontKind, string> = {
  sans: 'var(--font-sans)',
  serif: 'ui-serif, Georgia, serif',
  mono: 'var(--font-mono)',
};

/**
 * A family name as a CSS font stack. The generic tail matters: a family that
 * fails to load (a system font the user later removes) has to land somewhere
 * sensible rather than on the browser's default serif.
 */
export function fontStack(family: string, kind: FontKind) {
  if (!family) return '';
  return `'${family.replace(/'/g, "\\'")}', ${GENERIC[kind]}`;
}

let installed: Promise<string[]> | null = null;

/**
 * Installed families, fetched once per session. Enumerating them walks the
 * system font directories, so this is called when a picker first opens rather
 * than at startup.
 */
export function installedFonts(): Promise<string[]> {
  installed ??= commands
    .listSystemFonts()
    .then((result) => (result.status === 'ok' ? result.data : []))
    .catch((error) => {
      console.error('Failed to list system fonts:', error);
      return [];
    });
  return installed;
}
