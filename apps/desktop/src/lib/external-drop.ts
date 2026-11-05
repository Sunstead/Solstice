import { Actions, DockLocation, TabSetNode, type Model } from 'flexlayout-react';

import { getFileNameFromPath } from '@/lib/path-utils';
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
  model.doAction(Actions.deleteTab(placeholderId));
  const ids = paths.map((path, i) => {
    // The path, as other tabs' ids, unless a tab already has it.
    const id = model.getNodeById(path) ? `${path}#${Date.now()}-${i}` : path;
    const tab = { type: 'tab', id, name: getFileNameFromPath(path), component: 'editor', config: { path } };
    model.doAction(Actions.addNode(tab, parent.getId(), DockLocation.CENTER, at + i));
    return id;
  });
  if (ids[0]) model.doAction(Actions.selectTab(ids[0]));
}
