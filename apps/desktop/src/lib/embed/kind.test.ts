import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { canvasGround, fileViewKind, isVectorImage, readsAsText, searchedTextExtensions } from './kind';
import { getFileExtension } from '@/lib/utils';

// The image viewer pixelates a zoomed-in bitmap so its pixels show; a vector
// image (a drawing's SVG) is drawn sharp at any zoom instead.
describe('isVectorImage', () => {
  it('is true for SVGs, drawings included', () => {
    expect(isVectorImage('/v/Logo.svg')).toBe(true);
    expect(isVectorImage('/v/Ideas.drawing.svg')).toBe(true);
    expect(isVectorImage('/v/IDEAS.SVG')).toBe(true);
  });

  it('is false for bitmaps', () => {
    expect(isVectorImage('/v/photo.png')).toBe(false);
    expect(isVectorImage('/v/scan.jpeg')).toBe(false);
  });
});

// A drawing is white paper that goes on forever, as on the iPad, whatever
// ground the viewer gives other images.
describe('canvasGround', () => {
  it('is paper for drawings', () => {
    expect(canvasGround('/v/Ideas.drawing.svg')).toBe('paper');
    expect(canvasGround('/v/IDEAS.DRAWING.SVG')).toBe('paper');
  });

  it('is dark paper when dark paper is on', () => {
    expect(canvasGround('/v/Ideas.drawing.svg', true)).toBe('dark-paper');
    expect(canvasGround('/v/Ideas.drawing.svg', false)).toBe('paper');
  });

  it('is never dark paper for other images', () => {
    expect(canvasGround('/v/photo.png', true)).toBeUndefined();
  });

  it('is the setting for other images', () => {
    expect(canvasGround('/v/Logo.svg')).toBeUndefined();
    expect(canvasGround('/v/photo.png')).toBeUndefined();
  });
});

// A file opened in a tab: code and plain text open in the code editor, never
// the rich one, which would rewrite them as markdown.
describe('fileViewKind', () => {
  it('opens code and text in the code editor', () => {
    expect(fileViewKind('/v/script.py')).toBe('code');
    expect(fileViewKind('/v/data.json')).toBe('code');
    expect(fileViewKind('/v/notes.txt')).toBe('code');
    expect(fileViewKind('/v/server.LOG')).toBe('code');
    expect(fileViewKind('/v/prices.csv')).toBe('code');
    expect(fileViewKind('/v/app.env')).toBe('code');
  });

  it('opens extensionless files as code, whatever the folders are called', () => {
    expect(fileViewKind('/v/Makefile')).toBe('code');
    expect(fileViewKind('/Users/me/my.vault/LICENSE')).toBe('code');
    expect(fileViewKind('/v/.gitignore')).toBe('code');
  });

  it('leaves notes, boards, drawings and media to their own views', () => {
    expect(fileViewKind('/v/Note.md')).toBe('markdown');
    expect(fileViewKind('/v/Groceries.task.md')).toBe('markdown');
    expect(fileViewKind('/v/Sketch.drawing.svg')).toBe('image');
    expect(fileViewKind('/v/logo.svg')).toBe('image');
    expect(fileViewKind('/v/Board.canvas')).toBe('canvas');
    expect(fileViewKind('/v/Paper.pdf')).toBe('pdf');
  });

  it('leaves an unknown extension to be tried as text', () => {
    expect(fileViewKind('/v/archive.bin')).toBe('unknown');
  });
});

// An unknown extension opens as text only if it reads as text.
describe('readsAsText', () => {
  it('takes plain text', () => {
    expect(readsAsText('key = value\n')).toBe(true);
  });

  it('refuses binary: NUL bytes or undecodable bytes early on', () => {
    expect(readsAsText('PK\u0003\u0004\u0000\u0000rest')).toBe(false);
    expect(readsAsText('\uFFFD\uFFFDJFIF')).toBe(false);
    expect(readsAsText(`${'a'.repeat(9000)}\u0000`)).toBe(true);
  });

  it('refuses a file over 10 MB', () => {
    expect(readsAsText('a'.repeat(10 * 1024 * 1024 + 1))).toBe(false);
  });
});

// The search index (solstice-search) reads the same files as text: its list
// is this one, less what the app shows some other way.
describe('the search index agrees', () => {
  it('lists the same extensions', () => {
    const file = path.resolve(__dirname, '../../../../../crates/solstice-search/src/text_extensions.json');
    const theirs = JSON.parse(readFileSync(file, 'utf8')) as string[];
    expect(theirs).toEqual(searchedTextExtensions());
  });
});

describe('getFileExtension', () => {
  it('reads the file name, not the folders', () => {
    expect(getFileExtension('/Users/me/my.vault/LICENSE')).toBe('');
    expect(getFileExtension('/v/.env')).toBe('');
    expect(getFileExtension('/v/a.b/c.PY')).toBe('PY');
    expect(getFileExtension('C:\\v\\a.b\\Makefile')).toBe('');
  });
});
