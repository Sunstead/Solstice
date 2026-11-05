import { useMemo, useState } from 'react';
import { Actions, TabNode, TabSetNode } from 'flexlayout-react';

import { ActionMenu, type ActionMenuRequest } from '@/components/ui/action-menu';
import { can } from '@/lib/backend/platform';
import { getFileNameFromPath } from '@/lib/path-utils';
import { tabMenuActions } from '@/lib/tab-menu-actions';
import { moveTabToNewWindow, moveTabToWindow, useSiblingWindows } from '@/lib/tab-transfer';
import { useLayout } from '@/hooks/use-layout';
import { closeTab } from '@/lib/tab-motion';

import type { TabMenuRequest } from '@/lib/tab-long-press';

/** The tabs after `tab` in its strip. */
function tabsAfter(tab: TabNode): TabNode[] {
  const parent = tab.getParent();
  if (!(parent instanceof TabSetNode)) return [];
  const children = parent.getChildren();
  return children.slice(children.indexOf(tab) + 1).filter((n): n is TabNode => n instanceof TabNode);
}

/**
 * A tab's menu (`tabMenuActions`): a dropdown at the pointer on a computer,
 * the bottom sheet on a touch screen, from a hold as from a right click.
 */
export function TabMenu({
  request,
  onClose,
}: {
  request: TabMenuRequest | null;
  onClose: () => void;
}) {
  const model = useLayout((s) => s.model);
  const siblings = useSiblingWindows();
  // Kept while the menu animates out, so it doesn't jump to the corner.
  const [at, setAt] = useState(request);
  if (request && request !== at) setAt(request);

  const shown = useMemo((): ActionMenuRequest | null => {
    if (!at) return null;
    // From a hold, the tab may be on its way somewhere: a modal menu's
    // backdrop would take the drag from flexlayout. A right click's menu
    // stays modal, so a click outside only closes it, as on macOS.
    const place = { x: at.x, y: at.y, modal: !at.held };
    const tab = model?.getNodeById(at.tabId);
    if (!model || !(tab instanceof TabNode)) return { title: '', groups: [], ...place };
    const after = tabsAfter(tab);
    const groups = tabMenuActions(
      {
        tabsAfter: after.length,
        canClose: tab.isEnableClose(),
        multiWindow: can.multiWindow,
        siblings: siblings.map((w, i) => ({
          label: w.label,
          name: w.kind.type === 'full' ? `${getFileNameFromPath(w.workspace ?? '')} (main window)` : `Window ${i + 1}`,
        })),
      },
      {
        newTabToRight: () => {
          const parent = tab.getParent();
          if (!(parent instanceof TabSetNode)) return;
          useLayout.getState().newBlankTab(parent.getId(), parent.getChildren().indexOf(tab) + 1);
        },
        // At once, without each one's close motion: several easing out
        // together would fight over the strip.
        closeToRight: () => after.forEach((t) => model.doAction(Actions.deleteTab(t.getId()))),
        moveToNewWindow: () => moveTabToNewWindow(model, tab.getId()),
        moveToWindow: (label) => moveTabToWindow(model, tab.getId(), label),
        close: () => closeTab(model, tab.getId(), { pointer: false }),
      },
    );
    return { title: tab.getName(), groups, ...place };
  }, [at, model, siblings]);

  return <ActionMenu open={request !== null} shown={shown} onClose={onClose} />;
}
