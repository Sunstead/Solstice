import { commands } from '@/lib/backend';
import { nativeShare, type Rect } from '@/lib/backend/native';
import { can, shell } from '@/lib/backend/platform';
import { assetUrl, message, save } from '@/lib/backend/shell';
import { flushAllAutosavers } from '@/lib/autosave';
import { isDrawing } from '@/lib/embed/kind';
import { basename } from '@/lib/wikilink/target';
import { exportHtml, noteBody, notePage, pageSizeFor, type PageSpec } from '@/lib/export/document';
import { DRAWING_CSS, drawingBody, drawingPage, drawingPng, svgSize } from '@/lib/export/drawing';
import { printHtml } from '@/lib/export/print';
import { appSources, editorVars, exportStylesheet, fontFaces } from '@/lib/export/sources';
import type { ShareFormat } from './targets';
import { download, shareOrDownload } from './web';

/**
 * Share, Export as PDF and Save a Copy, for every surface that offers them
 * (`targets.ts` decides which). Errors are shown, not thrown: these run from
 * menus and buttons with nothing to catch them.
 */

/** A file's name without its kind: `Plan.md` → Plan, `Sketch.drawing.svg` → Sketch. */
function stem(path: string): string {
  return basename(path).replace(/\.drawing\.svg$/i, '').replace(/\.[^.]+$/, '');
}

/**
 * Where a share sheet should point: the file's row in the tree when that's
 * where it was asked for, else the share button of a shown header for it,
 * else nowhere in particular (the sheet's own default).
 */
export function shareAnchor(path: string, from: 'tree' | 'header' = 'header'): Rect | null {
  const selectors = from === 'tree' ? ['[data-tree-path]', '[data-share-anchor]'] : ['[data-share-anchor]'];
  for (const selector of selectors) {
    for (const element of document.querySelectorAll<HTMLElement>(selector)) {
      const owner = element.dataset.treePath ?? element.dataset.shareAnchor;
      if (owner !== path || element.getClientRects().length === 0) continue;
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    }
  }
  return null;
}

async function fail(what: string, error: unknown) {
  console.error(`[share] ${what} failed:`, error);
  await message(error instanceof Error ? error.message : String(error), { title: `Couldn't ${what}`, kind: 'error' });
}

async function readText(path: string): Promise<string> {
  // What's on screen, not a save still on its way.
  await flushAllAutosavers();
  const read = await commands.readFile(path);
  if (read.status === 'error') throw new Error(read.error);
  return read.data;
}

/** The page a note or drawing prints as. */
async function exportPage(path: string): Promise<{ html: string; page: PageSpec }> {
  const text = await readText(path);
  const title = stem(path);
  if (isDrawing(path)) {
    const page = drawingPage(svgSize(text));
    return { html: exportHtml({ title, body: drawingBody(text), css: DRAWING_CSS, page, vars: {} }), page };
  }
  const page = notePage(pageSizeFor(navigator.language));
  const vars = editorVars();
  const [body, css, fonts] = await Promise.all([noteBody(path, text, appSources), exportStylesheet(), fontFaces(vars)]);
  return { html: exportHtml({ title, body: body.outerHTML, css: `${fonts}\n${css}`, page, vars }), page };
}

/** Writes the PDF at `out`: in Swift on iOS, in a hidden window on the Mac. */
async function writePdf(html: string, page: PageSpec, out: string) {
  if (shell === 'mobile') return nativeShare.pdf(html, page, out);
  const result = await commands.renderPdf(html, page, out);
  if (result.status === 'error') throw new Error(result.error);
}

async function tempPath(name: string): Promise<string> {
  const result = await commands.exportTempPath(name);
  if (result.status === 'error') throw new Error(result.error);
  return result.data;
}

async function sharePaths(paths: string[], anchor: Rect | null) {
  if (shell === 'mobile') return nativeShare.share(paths, anchor);
  const result = await commands.shareFiles(paths, anchor);
  if (result.status === 'error') throw new Error(result.error);
}

async function fileBlob(path: string): Promise<File> {
  const response = await fetch(assetUrl(path));
  if (!response.ok) throw new Error(`${basename(path)} couldn't be read.`);
  return new File([await response.blob()], basename(path), { type: response.headers.get('Content-Type') ?? '' });
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export async function shareFile(path: string, format: ShareFormat, anchor = shareAnchor(path)): Promise<void> {
  try {
    if (format === 'file') {
      await flushAllAutosavers();
      if (shell === 'web') return await shareOrDownload(await fileBlob(path));
      return await sharePaths([path], anchor);
    }
    if (format === 'image') {
      const png = await drawingPng(await readText(path));
      const name = `${stem(path)}.png`;
      if (shell === 'web') return await shareOrDownload(new File([png], name, { type: 'image/png' }));
      const written = await commands.writeExportFile(name, toBase64(png));
      if (written.status === 'error') throw new Error(written.error);
      return await sharePaths([written.data], anchor);
    }
    const { html, page } = await exportPage(path);
    const out = await tempPath(`${stem(path)}.pdf`);
    await writePdf(html, page, out);
    await sharePaths([out], anchor);
  } catch (error) {
    await fail('share it', error);
  }
}

/**
 * A PDF of a note or drawing, saved where the person picks (on iOS, in
 * Files); printed where no PDF can be written here.
 */
export async function exportPdf(path: string): Promise<void> {
  try {
    const { html, page } = await exportPage(path);
    if (!can.writePdf) return await printHtml(html);
    const name = `${stem(path)}.pdf`;
    if (shell === 'mobile') {
      const out = await tempPath(name);
      await writePdf(html, page, out);
      await nativeShare.exportFiles([out]);
      return;
    }
    const out = await save({ defaultPath: name, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (out) await writePdf(html, page, out);
  } catch (error) {
    await fail('export the PDF', error);
  }
}

/** The file itself, somewhere else: a save dialog, Files, or a download. */
export async function saveCopy(path: string): Promise<void> {
  try {
    await flushAllAutosavers();
    if (shell === 'web') return download(await fileBlob(path));
    if (shell === 'mobile') {
      await nativeShare.exportFiles([path]);
      return;
    }
    const out = await save({ defaultPath: basename(path) });
    if (!out) return;
    const copied = await commands.copyPath(path, out);
    if (copied.status === 'error') throw new Error(copied.error);
  } catch (error) {
    await fail('save a copy', error);
  }
}
