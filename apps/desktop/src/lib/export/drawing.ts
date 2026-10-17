import type { PageSpec } from './document';

/**
 * A drawing (`*.drawing.svg`) to send where SVGs don't show: a PNG, or a PDF
 * page its own size. Its viewBox is already the ink's bounds on white
 * (`DrawingFile.swift`), so neither crops; both keep its true colours, whatever
 * Dark Paper shows on screen.
 */

type Size = { width: number; height: number };

/** As `DrawingFile` makes an empty drawing: a 1024×768 page. */
const EMPTY: Size = { width: 1024, height: 768 };
/** Safari's canvas limit is larger in area, but not on every side. */
const MAX_SIDE = 8192;

export function svgSize(svg: string): Size {
  const tag = /<svg\b[^>]*>/i.exec(svg)?.[0] ?? '';
  const attr = (name: string) => new RegExp(`\\s${name}="\\s*([\\d.]+)`, 'i').exec(tag)?.[1];
  const width = Number(attr('width'));
  const height = Number(attr('height'));
  if (width > 0 && height > 0) return { width, height };
  const box = /\sviewBox="([^"]+)"/i.exec(tag)?.[1].trim().split(/[\s,]+/).map(Number);
  if (box?.length === 4 && box[2] > 0 && box[3] > 0) return { width: box[2], height: box[3] };
  return EMPTY;
}

/** Twice the size, for sharp pixels on any screen, within what a canvas holds. */
export function imageScale(size: Size): number {
  return Math.min(2, MAX_SIDE / Math.max(size.width, size.height));
}

export function drawingPage(size: Size): PageSpec {
  return { ...size, margin: 0 };
}

/** The drawing as a PNG, on its white paper. */
export async function drawingPng(svg: string): Promise<Uint8Array> {
  const size = svgSize(svg);
  const scale = imageScale(size);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(size.width * scale);
    canvas.height = Math.round(size.height * scale);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No canvas to draw the image on.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error("Couldn't make the image.");
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** The page body for a drawing's PDF: the SVG itself, filling its page. */
export function drawingBody(svg: string): string {
  const inline = svg.replace(/^\s*<\?xml[^>]*>\s*/i, '');
  return `<div class="solstice-export-drawing">${inline}</div>`;
}

export const DRAWING_CSS = `
html, body { margin: 0; background: #fff; }
/* The page is the drawing's size, so its width is the drawing's. */
.solstice-export-drawing svg { display: block; width: 100%; height: auto; }
`;
