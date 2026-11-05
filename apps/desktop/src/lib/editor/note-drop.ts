import { embedKind } from '@/lib/embed/kind';
import type { MovableEntry } from '@/lib/file-operations';
import { getRelativePath } from '@/lib/path-utils';
import { shortestWikilinkTarget, type WikilinkIndexSnapshot } from '@/lib/stores/wikilink-index';

/** What a Shift-drop puts into a note, and where. */
export interface NoteDrop {
  files: File[];
  entry: MovableEntry | null;
  x: number;
  y: number;
}

/** Each open note's editor, by its element: the layout's overlay keeps drops from reaching it. */
const notes = new WeakMap<Element, (drop: NoteDrop) => boolean>();

export function registerNoteDrop(dom: Element, take: (drop: NoteDrop) => boolean) {
  notes.set(dom, take);
}

/** Hands a drop to the note under the pointer, if there is one, through the overlay. */
export function dropIntoNoteAt(drop: NoteDrop): boolean {
  for (const element of document.elementsFromPoint(drop.x, drop.y)) {
    const note = element.closest('.ProseMirror');
    const take = note && notes.get(note);
    if (take) return take(drop);
  }
  return false;
}

/** How a note refers to a file from the explorer: an image embeds, anything else is a link. */
export function entryLink(entry: MovableEntry, root: string, index: WikilinkIndexSnapshot) {
  const relative = getRelativePath(entry.path, root);
  return { embed: embedKind(entry.path) === 'image', target: shortestWikilinkTarget(relative, index) };
}
