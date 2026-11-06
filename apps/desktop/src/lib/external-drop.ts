import { Actions, DockLocation, TabSetNode, type Model } from 'flexlayout-react';

import { getFileNameFromPath } from '@/lib/path-utils';
import { dropIntoNoteAt } from '@/lib/editor/note-drop';
import { useFileTreeDragState } from '@/hooks/use-file-tree-drag-state';
import { TAB_TYPE } from '@/lib/tab-transfer';

/** Files dragged in from another app (Finder, a file manager), not a tab or the tree. */
export function isOsFileDrag(transfer: DataTransfer | null): boolean {
  if (!transfer) return false;
  const types = [...transfer.types];
  return types.includes('Files') && !types.includes(TAB_TYPE);
}

/**
 * A drop from another app lands as a placeholder tab where flexlayout put
 * it (the paths only come once it's dropped: `take_dropped_paths`); this
 * swaps it for a tab per file, in order, or takes it away for none.
 */
export function fillDropped(model: Model, placeholderId: string, paths: string[]) {
  const placeholder = model.getNodeById(placeholderId);
  const parent = placeholder?.getParent();
  if (!placeholder || !(parent instanceof TabSetNode)) return;
  const at = parent.getChildren().indexOf(placeholder);
  const ids = paths.map((path, i) => {
    // The path, as other tabs' ids, unless a tab already has it.
    const id = model.getNodeById(path) ? `${path}#${Date.now()}-${i}` : path;
    const tab = { type: 'tab', id, name: getFileNameFromPath(path), component: 'editor', config: { path } };
    model.doAction(Actions.addNode(tab, parent.getId(), DockLocation.CENTER, at + 1 + i));
    return id;
  });
  // Last: a new split goes with its last tab, and they'd have nowhere to land.
  model.doAction(Actions.deleteTab(placeholderId));
  if (ids[0]) model.doAction(Actions.selectTab(ids[0]));
}

let inserted: { shown: string | null } | null = null;

/**
 * Shift over a note's text puts what's dropped into the note instead of
 * opening it, as in VS Code. Watched before the layout's own drop (`capture`),
 * while the note is still the tab showing: the layout then adds its tab
 * anyway, and `undoLayoutDrop` takes it out again and shows the note.
 */
export function watchShiftDrops(model: () => Model | null, target: EventTarget = window) {
  const onDrop = (e: Event) => {
    const event = e as DragEvent;
    inserted = null;
    if (!event.shiftKey) return;
    const entry = useFileTreeDragState.getState().draggedEntry;
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (entry?.is_dir || (!entry && files.length === 0)) return;
    const shown = model()?.getActiveTabset()?.getSelectedNode()?.getId() ?? null;
    if (dropIntoNoteAt({ entry, files, x: event.clientX, y: event.clientY })) inserted = { shown };
  };
  target.addEventListener('drop', onDrop, true);
  return () => target.removeEventListener('drop', onDrop, true);
}

/** Whether this drop went into a note; if so, its new tab is gone again. */
export function undoLayoutDrop(model: Model, tabId: string): boolean {
  if (!inserted) return false;
  const { shown } = inserted;
  inserted = null;
  model.doAction(Actions.deleteTab(tabId));
  if (shown) model.doAction(Actions.selectTab(shown));
  return true;
}
