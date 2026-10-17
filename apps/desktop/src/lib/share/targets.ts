import { isDrawing } from '@/lib/embed/kind';

/** What a file is sent as: itself, a PDF made from it, or a picture of it. */
export type ShareFormat = 'file' | 'pdf' | 'image';

/** What the platform can do (`can.share`, `can.writePdf`). */
export type ShareAbilities = {
  /** A share sheet (or, on the web, a download standing in for one). */
  share: boolean;
  /** Making a PDF file; without it, Export as PDF prints. */
  writePdf: boolean;
};

export type FileActions = {
  /** In the order they're offered; the first is the share button's default. */
  share: ShareFormat[];
  /** Notes and drawings: a PDF to save (or, where none can be made, print). */
  exportPdf: boolean;
  saveCopy: boolean;
};

const isNote = (path: string) => path.toLowerCase().endsWith('.md');

/**
 * Every way to get `path` out of the app, by what it is and what the
 * platform can do. A note goes as a PDF to read or as its Markdown; a drawing
 * as a picture or a PDF, since few apps show an SVG (Save a Copy keeps it);
 * anything else as it is.
 */
export function fileActions(path: string, can: ShareAbilities): FileActions {
  const note = isNote(path);
  const drawing = isDrawing(path);
  const pdf = can.writePdf ? (['pdf'] as const) : [];
  const share: ShareFormat[] = !can.share
    ? []
    : note
      ? [...pdf, 'file']
      : drawing
        ? ['image', ...pdf]
        : ['file'];
  return { share, exportPdf: note || drawing, saveCopy: true };
}

/** In a Share submenu: As PDF..., As Markdown..., As Image... */
export function shareAsLabel(format: ShareFormat, path: string): string {
  if (format === 'pdf') return 'As PDF...';
  if (format === 'image') return 'As Image...';
  return isNote(path) ? 'As Markdown...' : 'As File...';
}

export function shareLabel(format: ShareFormat, path: string): string {
  if (format === 'pdf') return 'Share as PDF...';
  if (format === 'image') return 'Share as Image...';
  return isNote(path) ? 'Share as Markdown...' : 'Share...';
}
