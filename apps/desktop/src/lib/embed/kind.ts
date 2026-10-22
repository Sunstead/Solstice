import { getFileExtension } from '@/lib/utils';

export type EmbedKind =
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'markdown'
  | 'canvas'
  | 'unknown';

/**
 * One table, so adding a future embed type is a line here plus a branch in the
 * node view rather than a new plugin.
 */
const BY_EXTENSION: Record<string, EmbedKind> = {
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  avif: 'image',
  bmp: 'image',
  svg: 'image',

  mp4: 'video',
  webm: 'video',
  mov: 'video',
  m4v: 'video',

  mp3: 'audio',
  wav: 'audio',
  m4a: 'audio',
  ogg: 'audio',
  flac: 'audio',

  pdf: 'pdf',
  md: 'markdown',
  canvas: 'canvas',
};

/** An extensionless target is a note, matching how wikilinks resolve. */
export function embedKind(path: string): EmbedKind {
  const extension = getFileExtension(path).toLowerCase();
  if (!extension) return 'markdown';

  return BY_EXTENSION[extension] ?? 'unknown';
}

/**
 * A drawing from the iOS app (`*.drawing.svg`). Everywhere it's an image;
 * the iOS app opens it to draw on.
 */
export function isDrawing(path: string): boolean {
  return hasTypeExtension(path, 'drawing.svg');
}

/** A note shown as a board (`*.task.md`, `lib/task-board/`). */
export function isTaskBoard(path: string): boolean {
  return hasTypeExtension(path, 'task.md');
}

/** Whether the file name ends in `.extension` with a name before it. */
function hasTypeExtension(path: string, extension: string): boolean {
  const name = path.slice(path.search(/[^\\/]*$/)).toLowerCase();
  return name.length > extension.length + 1 && name.endsWith(`.${extension}`);
}

/** An image drawn from shapes, sharp at any zoom: never shown as pixels. */
export function isVectorImage(path: string): boolean {
  return getFileExtension(path).toLowerCase() === 'svg';
}

/**
 * The image viewer's ground under `path`: a drawing is paper in every
 * direction, as the iPad draws it, white or dark (`ink.darkPaper`); anything
 * else takes the `viewer.imageBackground` setting.
 */
export function canvasGround(path: string, dark = false): 'paper' | 'dark-paper' | undefined {
  if (!isDrawing(path)) return undefined;
  return dark ? 'dark-paper' : 'paper';
}
