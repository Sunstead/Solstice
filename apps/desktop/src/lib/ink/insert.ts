/**
 * What the ink ribbon's + inserts (`InsertMenu`), on each kind of surface.
 * Every item is PaperKit's own (its shapes, text box, loupe, an image), put
 * where the canvas in view suggests, selected to move; Apple's insert menu
 * is no longer shown. Stickers have no API outside that menu, so there are
 * none.
 */

export type MarkupSurface = 'pdf' | 'drawing' | 'image';

/** PaperKit's `ShapeConfiguration.Shape` cases, as the native side names them. */
export type InsertShape =
  'rectangle' | 'roundedRectangle' | 'ellipse' | 'star' | 'regularPolygon' | 'chatBubble' | 'arrowShape';

export type InsertItem = {
  id: 'text' | 'shape' | 'line' | 'arrow' | 'loupe' | 'image' | 'addPage' | 'pages';
  label: string;
  /** For `shape`: the submenu. */
  shapes?: { shape: InsertShape; label: string }[];
};

const SHAPES: { shape: InsertShape; label: string }[] = [
  { shape: 'rectangle', label: 'Rectangle' },
  { shape: 'roundedRectangle', label: 'Rounded Rectangle' },
  { shape: 'ellipse', label: 'Oval' },
  { shape: 'star', label: 'Star' },
  { shape: 'regularPolygon', label: 'Polygon' },
  { shape: 'chatBubble', label: 'Speech Bubble' },
  { shape: 'arrowShape', label: 'Arrow Shape' },
];

export function insertItems(surface: MarkupSurface): InsertItem[] {
  const items: InsertItem[] = [
    { id: 'text', label: 'Text' },
    { id: 'shape', label: 'Shape', shapes: SHAPES },
    { id: 'line', label: 'Line' },
    { id: 'arrow', label: 'Arrow' },
    { id: 'loupe', label: 'Loupe' },
    { id: 'image', label: 'Image…' },
  ];
  if (surface === 'pdf') items.push({ id: 'addPage', label: 'Add Page' }, { id: 'pages', label: 'Pages…' });
  return items;
}

/**
 * Bitmaps the iPad marks up in place (`ImageSurface`) and can write back in
 * their own format; GIFs (animated) and WebP (no encoder) stay in the viewer.
 */
export function isMarkableImage(path: string): boolean {
  return /\.(png|jpe?g|heic)$/i.test(path);
}
