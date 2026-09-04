import { SvgComponent } from '@/lib/views/types';

import Markdown from './file-types/markdown.svg?react';
import Json from './file-types/json.svg?react';
import Pdf from './file-types/pdf.svg?react';
import Image from './file-types/image.svg?react';
import Video from './file-types/video.svg?react';
import Audio from './file-types/audio.svg?react';
import Folder from './file-types/folder.svg?react';
import FolderOpen from './file-types/folder_open.svg?react';
import Default from './file-types/file.svg?react';

export const fileIconRegistry: Record<string, SvgComponent> = {
  md: Markdown,
  json: Json,
  pdf: Pdf,
  png: Image,
  jpg: Image,
  gif: Image,
  webp: Image,
  avif: Image,
  bmp: Image,
  svg: Image,
  mp4: Video,
  webm: Video,
  mov: Video,
  m4v: Video,
  mp3: Audio,
  wav: Audio,
  m4a: Audio,
  ogg: Audio,
  flac: Audio,
};

export function getFolderIcon(open: boolean = false) {
  return open ? FolderOpen : Folder;
}

export function getFileIcon(ext: string) {
  return fileIconRegistry[ext.toLowerCase()] ?? Default;
}
