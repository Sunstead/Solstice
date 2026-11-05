import { SvgComponent } from '@/lib/views/types';
import { typeExtension } from '@/lib/utils';

import Markdown from './file-types/markdown.svg?react';
import Json from './file-types/json.svg?react';
import Canvas from './file-types/canvas.svg?react';
import Pdf from './file-types/pdf.svg?react';
import Image from './file-types/image.svg?react';
import Video from './file-types/video.svg?react';
import Audio from './file-types/audio.svg?react';
import Drawing from './file-types/drawing.svg?react';
import Task from './file-types/task.svg?react';
import Code from './file-types/code.svg?react';
import Text from './file-types/text.svg?react';
import Folder from './file-types/folder.svg?react';
import FolderOpen from './file-types/folder_open.svg?react';
import Default from './file-types/file.svg?react';

export const fileIconRegistry: Record<string, SvgComponent> = {
  md: Markdown,
  json: Json,
  canvas: Canvas,
  pdf: Pdf,
  png: Image,
  jpg: Image,
  gif: Image,
  webp: Image,
  avif: Image,
  bmp: Image,
  svg: Image,
  'drawing.svg': Drawing,
  'task.md': Task,
  mp4: Video,
  webm: Video,
  mov: Video,
  m4v: Video,
  mp3: Audio,
  wav: Audio,
  m4a: Audio,
  ogg: Audio,
  flac: Audio,
  // Code and plain text open in a code tab (`fileViewKind`).
  py: Code,
  js: Code,
  mjs: Code,
  cjs: Code,
  jsx: Code,
  ts: Code,
  tsx: Code,
  rs: Code,
  go: Code,
  c: Code,
  h: Code,
  cpp: Code,
  hpp: Code,
  cc: Code,
  cs: Code,
  java: Code,
  kt: Code,
  swift: Code,
  rb: Code,
  php: Code,
  lua: Code,
  sh: Code,
  bash: Code,
  zsh: Code,
  ps1: Code,
  sql: Code,
  html: Code,
  htm: Code,
  css: Code,
  scss: Code,
  sass: Code,
  less: Code,
  xml: Code,
  yaml: Code,
  yml: Code,
  toml: Code,
  ini: Code,
  vue: Code,
  dart: Code,
  scala: Code,
  r: Code,
  jl: Code,
  hs: Code,
  ex: Code,
  exs: Code,
  erl: Code,
  clj: Code,
  pl: Code,
  m: Code,
  mm: Code,
  txt: Text,
  log: Text,
  csv: Text,
  tsv: Text,
  env: Text,
  conf: Text,
};

export function getFolderIcon(open: boolean = false) {
  return open ? FolderOpen : Folder;
}

export function getFileIcon(ext: string) {
  return fileIconRegistry[ext.toLowerCase()] ?? Default;
}

/** The icon for a file name, by a two-part extension the registry has (`task.md`) or its last. */
export function getFileIconFor(filename: string) {
  return getFileIcon(typeExtension(filename, Object.keys(fileIconRegistry)));
}
