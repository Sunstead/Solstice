import { RotateCcw, X } from 'lucide-react';
import type { TabNode } from 'flexlayout-react';

import { useIsSaving } from '@/lib/stores/save-status';

/**
 * The icon inside a tab's close button: a spinner while the file has an edit
 * waiting to be written, the close cross otherwise. The hover swap back to the
 * cross lives in `flexlayout.css`, because the element receiving the hover is
 * flexlayout's own button wrapper rather than this one.
 *
 * Only debounced autosave reports a file as saving, so under instant saving
 * this is always the cross.
 */
export function TabCloseIcon({ node }: { node: TabNode }) {
  // The path lives in config; tab ids are independent of it.
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
