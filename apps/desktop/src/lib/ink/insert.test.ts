import { describe, expect, it } from 'vitest';

import { insertItems, isMarkableImage } from './insert';

const ids = (kind: Parameters<typeof insertItems>[0]) => insertItems(kind).map((item) => item.id);

describe('insertItems', () => {
  it('offers text, shapes, lines, a loupe and an image everywhere, and no stickers', () => {
    for (const kind of ['pdf', 'drawing', 'image'] as const) {
      expect(ids(kind)).toEqual(expect.arrayContaining(['text', 'shape', 'line', 'arrow', 'loupe', 'image']));
      expect(ids(kind)).not.toContain('sticker');
    }
  });

  it('adds pages only to a PDF', () => {
    expect(ids('pdf')).toEqual(expect.arrayContaining(['addPage', 'pages']));
    expect(ids('drawing')).not.toContain('addPage');
    expect(ids('image')).not.toContain('pages');
  });

  it('lists every PaperKit shape under Shapes', () => {
    const shapes = insertItems('pdf').find((item) => item.id === 'shape')?.shapes ?? [];
    expect(shapes.map((s) => s.shape)).toEqual([
      'rectangle',
      'roundedRectangle',
      'ellipse',
      'star',
      'regularPolygon',
      'chatBubble',
      'arrowShape',
    ]);
  });
});

describe('isMarkableImage', () => {
  it('takes the bitmaps the iPad can write back', () => {
    for (const path of ['a.png', 'b.JPG', 'c.jpeg', 'd.heic', '/x/y/photo.PNG'])
      expect(isMarkableImage(path)).toBe(true);
  });

  it('leaves the rest to the image viewer', () => {
    for (const path of ['a.gif', 'b.webp', 'c.svg', 'd.drawing.svg', 'e.md', 'png'])
      expect(isMarkableImage(path)).toBe(false);
  });
});
