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
