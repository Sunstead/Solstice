import { useState } from 'react';
import { Actions, TabNode, TabSetNode } from 'flexlayout-react';
import { AppWindow, ArrowRightToLine, Plus, SquareArrowOutUpRight, X } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@sunstead/ui/components/dropdown-menu';
import { can } from '@/lib/backend/platform';
import { getFileNameFromPath } from '@/lib/path-utils';
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

/** A tab's menu: New Tab to the Right, Close Tabs to the Right, Close Tab. */
export function TabMenu({
  request,
  onClose,
}: {
  request: TabMenuRequest | null;
  onClose: () => void;
}) {
  const model = useLayout((s) => s.model);
  // Kept while the menu animates out, so it doesn't jump to the corner.
  const [at, setAt] = useState(request);
  if (request && request !== at) setAt(request);

  const tab = at && model ? model.getNodeById(at.tabId) : undefined;
  const node = tab instanceof TabNode ? tab : null;
  const after = node ? tabsAfter(node) : [];
  const siblings = useSiblingWindows();

  const newTabToRight = () => {
    if (!node) return;
    const parent = node.getParent();
    if (!(parent instanceof TabSetNode)) return;
    useLayout.getState().newBlankTab(parent.getId(), parent.getChildren().indexOf(node) + 1);
  };

  const closeToRight = () => {
    if (!model) return;
    // At once, without each one's close motion: several easing out together
    // would fight over the strip.
    for (const t of after) model.doAction(Actions.deleteTab(t.getId()));
  };

  return (
    <DropdownMenu
      open={request !== null}
      onOpenChange={(open) => !open && onClose()}
      // From a hold, the tab may be on its way somewhere: a modal menu's
      // backdrop would take the drag from flexlayout. A right click's menu
      // stays modal, so a click outside only closes it, as on macOS.
      modal={!at?.held}
    >
      <DropdownMenuTrigger
        nativeButton={false}
        render={
          <span
            aria-hidden
            tabIndex={-1}
            className='pointer-events-none fixed size-px'
            style={{ left: at?.x ?? 0, top: at?.y ?? 0 }}
          />
        }
      />
      <DropdownMenuContent className='w-auto min-w-52'>
        <DropdownMenuItem onClick={newTabToRight}>
          <Plus />
          New Tab to the Right
        </DropdownMenuItem>
        <DropdownMenuItem disabled={after.length === 0} onClick={closeToRight}>
          <ArrowRightToLine />
          Close Tabs to the Right
        </DropdownMenuItem>
        {can.multiWindow && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => model && node && moveTabToNewWindow(model, node.getId())}>
              <SquareArrowOutUpRight />
              Move to New Window
            </DropdownMenuItem>
            {siblings.length > 0 && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <AppWindow />
                  Move to Window
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {siblings.map((w, i) => (
                    <DropdownMenuItem
                      key={w.label}
                      onClick={() => model && node && moveTabToWindow(model, node.getId(), w.label)}
                    >
                      {w.kind.type === 'full'
                        ? `${getFileNameFromPath(w.workspace ?? '')} (main window)`
                        : `Window ${i + 1}`}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!node?.isEnableClose()}
          onClick={() => model && node && closeTab(model, node.getId(), { pointer: false })}
        >
          <X />
          Close Tab
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
