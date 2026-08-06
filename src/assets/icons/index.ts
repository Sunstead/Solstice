import { SvgComponent } from '@/lib/views/types';

import Markdown from './file-types/markdown.svg?react';
import Json from './file-types/json.svg?react';
import Folder from './file-types/folder.svg?react';
import Default from './file-types/file.svg?react';

export const fileIconRegistry: Record<string, SvgComponent> = {
  md: Markdown,
  json: Json,
};

export function getFolderIcon() {
  return Folder;
}

export function getFileIcon(ext: string) {
  return fileIconRegistry[ext.toLowerCase()] ?? Default;
}
