import { RotateCcw, X } from 'lucide-react';
import type { TabNode } from 'flexlayout-react';

import { useIsSaving } from '@/lib/stores/save-status';

/**
 * The icon inside a tab's close button.
 *
 * While the tab's file has an edit waiting to be written, this shows a
 * spinner instead of the close cross -- but only until you point at the
 * button, at which point the cross comes back so the tab stays closeable.
 * That hover swap is CSS (see `flexlayout.css`), because the element that
 * receives the hover is flexlayout's own button wrapper, not this one.
 *
 * Only the debounced autosave mode ever reports a file as saving, so with
 * instant saving on this is always just the cross.
 */
export function TabCloseIcon({ node }: { node: TabNode }) {
  // Read the path from config, not the tab id -- drag-opened tabs no longer
  // use the path as their id.
  const path = (node.getConfig() as { path?: string } | undefined)?.path;
  const saving = useIsSaving(path);

  if (!saving) return <X className='size-4' />;

  return (
    <span className='tab-close-saving relative flex size-4 items-center justify-center'>
      <RotateCcw className='tab-close-saving__spinner size-4 animate-spin [animation-direction:reverse]' />
      <X className='tab-close-saving__close size-4' />
    </span>
  );
}
