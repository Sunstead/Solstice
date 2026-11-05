import type { ReactNode } from 'react';
import { Copy, ListPlus, Palette, PencilLine, Plus, Trash2 } from 'lucide-react';

import type { Action } from '@/lib/menu-actions';

/** A card's menu. Cards aren't ticked, so there's no Mark Done. */
export function cardMenuActions(on: {
  edit: () => void;
  addSubtask: () => void;
  copy: () => void;
  remove: () => void;
}): Action[][] {
  return [
    [
      { id: 'edit', label: 'Edit', icon: PencilLine, onSelect: on.edit },
      { id: 'add-subtask', label: 'Add Sub-task', icon: ListPlus, onSelect: on.addSubtask },
      { id: 'copy', label: 'Copy', icon: Copy, onSelect: on.copy },
    ],
    [{ id: 'delete', label: 'Delete Card', icon: Trash2, destructive: true, onSelect: on.remove }],
  ];
}

/** A column's menu; `colors` is its swatches, a row of their own. */
export function columnMenuActions(on: {
  addCard: () => void;
  rename: () => void;
  colors: ReactNode;
  remove: () => void;
}): Action[][] {
  return [
    [
      { id: 'add-card', label: 'Add Card', icon: Plus, onSelect: on.addCard },
      { id: 'rename', label: 'Rename', icon: PencilLine, onSelect: on.rename },
    ],
    [{ id: 'color', label: 'Color', icon: Palette, content: on.colors }],
    [{ id: 'delete', label: 'Delete Column', icon: Trash2, destructive: true, onSelect: on.remove }],
  ];
}
