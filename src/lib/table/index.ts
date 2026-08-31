import type { MilkdownPlugin } from '@milkdown/kit/ctx';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { isInTable, selectedRect } from '@milkdown/kit/prose/tables';
import { $prose } from '@milkdown/kit/utils';

import { useTableTools } from '@/lib/stores/table-tools';

export type ColumnAlignment = 'left' | 'center' | 'right';

/**
 * Sets a column's alignment.
 *
 * Only the header cell matters: the table's `toMarkdown` builds the alignment
 * row from `node.content.firstChild` alone, so writing every cell in the
 * column would be work the serializer throws away.
 */
export function setColumnAlignment(
  view: EditorView,
  alignment: ColumnAlignment,
): boolean {
  if (!isInTable(view.state)) return false;

  const rect = selectedRect(view.state);
  const tr = view.state.tr;

  for (let column = rect.left; column < rect.right; column += 1) {
    const offset = rect.map.map[column];
    const cell = rect.table.nodeAt(offset);
    if (!cell) continue;

    tr.setNodeMarkup(rect.tableStart + offset, undefined, {
      ...cell.attrs,
      alignment,
    });
  }

  if (!tr.steps.length) return false;

  view.dispatch(tr);
  return true;
}

/** The alignment currently applied to the selected column, if any. */
export function currentColumnAlignment(view: EditorView): string | null {
  if (!isInTable(view.state)) return null;

  const rect = selectedRect(view.state);
  const cell = rect.table.nodeAt(rect.map.map[rect.left]);

  return (cell?.attrs.alignment as string | null) ?? null;
}

const tableToolsPlugin = $prose(
  () =>
    new Plugin({
      key: new PluginKey('table-tools'),
      view: () => ({
        update: (view) => {
          const store = useTableTools.getState();

          if (!isInTable(view.state)) {
            if (store.target) store.hide();
            return;
          }

          const { tableStart } = selectedRect(view.state);
          const coords = view.coordsAtPos(tableStart);
          const alignment = currentColumnAlignment(view);

          // Republishing an equal rect on every keystroke would re-render the
          // floating toolbar continuously while typing in a cell -- but the
          // alignment has to be part of that comparison too, or clicking an
          // align button (which moves nothing, just an attr) gets swallowed
          // by this same dedup and the button never shows itself pressed.
          if (
            store.target?.rect.top === coords.top &&
            store.target.rect.left === coords.left &&
            store.target.alignment === alignment
          ) {
            return;
          }

          store.show({ view, rect: { top: coords.top, left: coords.left }, alignment });
        },
        destroy: () => useTableTools.getState().hide(),
      }),
    }),
);

export const table: MilkdownPlugin[] = [tableToolsPlugin].flat();
