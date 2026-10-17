import { describe, expect, it } from 'vitest';
import { fileActions, shareAsLabel, shareLabel } from './targets';

const mac = { share: true, writePdf: true };
const windows = { share: false, writePdf: true };
const linux = { share: false, writePdf: false };
const web = { share: true, writePdf: false };

describe('fileActions', () => {
  it('shares a note as PDF or as Markdown, and exports it', () => {
    expect(fileActions('/w/Plan.md', mac)).toEqual({ share: ['pdf', 'file'], exportPdf: true, saveCopy: true });
  });

  it('shares a drawing as an image or a PDF; its svg is a copy away', () => {
    expect(fileActions('/w/Sketch.drawing.svg', mac)).toEqual({ share: ['image', 'pdf'], exportPdf: true, saveCopy: true });
  });

  it('shares anything else as it is', () => {
    for (const path of ['/w/paper.pdf', '/w/board.canvas', '/w/photo.png', '/w/plain.svg', '/w/data.csv']) {
      expect(fileActions(path, mac), path).toEqual({ share: ['file'], exportPdf: false, saveCopy: true });
    }
  });

  it('offers no sharing where there is no share sheet', () => {
    expect(fileActions('/w/Plan.md', windows)).toEqual({ share: [], exportPdf: true, saveCopy: true });
    expect(fileActions('/w/Plan.md', linux)).toEqual({ share: [], exportPdf: true, saveCopy: true });
  });

  it('shares no PDF where none can be made (the web prints instead)', () => {
    expect(fileActions('/w/Plan.md', web)).toEqual({ share: ['file'], exportPdf: true, saveCopy: true });
    expect(fileActions('/w/Sketch.drawing.svg', web)).toEqual({ share: ['image'], exportPdf: true, saveCopy: true });
  });

  it('knows a note by its extension in any case', () => {
    expect(fileActions('/w/PLAN.MD', mac).share).toEqual(['pdf', 'file']);
    expect(fileActions('/w/S.Drawing.SVG', mac).share).toEqual(['image', 'pdf']);
  });
});

describe('shareLabel', () => {
  it('names what is sent', () => {
    expect(shareLabel('file', '/w/Plan.md')).toBe('Share as Markdown...');
    expect(shareLabel('file', '/w/paper.pdf')).toBe('Share...');
    expect(shareLabel('pdf', '/w/Plan.md')).toBe('Share as PDF...');
    expect(shareLabel('image', '/w/S.drawing.svg')).toBe('Share as Image...');
  });

  it('names each choice under Share', () => {
    expect(shareAsLabel('pdf', '/w/Plan.md')).toBe('As PDF...');
    expect(shareAsLabel('file', '/w/Plan.md')).toBe('As Markdown...');
    expect(shareAsLabel('image', '/w/S.drawing.svg')).toBe('As Image...');
  });
});
