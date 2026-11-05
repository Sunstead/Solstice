import { AppWindow, ArrowRightToLine, Plus, SquareArrowOutUpRight, X } from 'lucide-react';

import type { Action } from './menu-actions';

export interface TabMenuContext {
  /** How many tabs follow this one in its strip. */
  tabsAfter: number;
  canClose: boolean;
  multiWindow: boolean;
  /** The app's other windows, named as the menu shows them. */
  siblings: { label: string; name: string }[];
}

export interface TabMenuHandlers {
  newTabToRight: () => void;
  closeToRight: () => void;
  moveToNewWindow: () => void;
  moveToWindow: (label: string) => void;
  close: () => void;
}

/** A tab's menu: New Tab to the Right, Close Tabs to the Right, the windows, Close Tab. */
export function tabMenuActions(ctx: TabMenuContext, on: TabMenuHandlers): Action[][] {
  const groups: Action[][] = [
    [
      { id: 'new-tab-right', label: 'New Tab to the Right', icon: Plus, onSelect: on.newTabToRight },
      {
        id: 'close-right',
        label: 'Close Tabs to the Right',
        icon: ArrowRightToLine,
        disabled: ctx.tabsAfter === 0,
        onSelect: on.closeToRight,
      },
    ],
  ];
  if (ctx.multiWindow) {
    const windows: Action[] = [
      { id: 'new-window', label: 'Move to New Window', icon: SquareArrowOutUpRight, onSelect: on.moveToNewWindow },
    ];
    if (ctx.siblings.length > 0) {
      windows.push({
        id: 'move-to-window',
        label: 'Move to Window',
        icon: AppWindow,
        items: ctx.siblings.map((w) => ({ id: w.label, label: w.name, onSelect: () => on.moveToWindow(w.label) })),
      });
    }
    groups.push(windows);
  }
  groups.push([{ id: 'close', label: 'Close Tab', icon: X, disabled: !ctx.canClose, onSelect: on.close }]);
  return groups;
}
