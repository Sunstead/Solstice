import type { TabNode } from 'flexlayout-react';

import { useLayout } from '@/hooks/use-layout';
import { getFileNameFromPath } from '@/lib/path-utils';
import { usePhoneNav } from '@/lib/stores/phone-nav';

/** The path the shown tab has open, if it's a file. */
export function tabPath(tab: TabNode | null): string | null {
  const path = (tab?.getConfig() as { path?: string } | undefined)?.path;
  return tab?.getComponent() === 'editor' && path ? path : null;
}

/** Steps through the notes this phone has shown, opening each in place. */
export function stepHistory(direction: 'back' | 'forward', current: string | null) {
  const path = usePhoneNav.getState().step(direction, current);
  if (path) useLayout.getState().openFile(path, getFileNameFromPath(path));
}
