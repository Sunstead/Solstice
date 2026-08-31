import type { MilkdownPlugin } from '@milkdown/kit/ctx';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

const TASK_SELECTOR = 'li[data-item-type="task"]';

/**
 * Clickable checkboxes for GFM task list items.
 *
 * The checkbox is drawn entirely in CSS, as a pseudo-element on the list item
 * (which the gfm preset already renders with `data-checked`). Nothing is added
 * to the document.
 *
 * An earlier version injected an `<input>` as a widget decoration, which is
 * the obvious approach and the wrong one: a `contenteditable="false"` replaced
 * element sitting in editable text makes the caret jump lines, change height,
 * and refuse to land after it -- prosemirror-view carries its own kludge for
 * one corner of the same problem. A pseudo-element cannot be selected, cannot
 * hold a caret, and does not exist as far as the DOM is concerned, so none of
 * that is possible.
 *
 * The trade-off is that the click has to be located by geometry rather than by
 * hit-testing an element, which is what `isInCheckbox` below does.
 */
function taskItemAt(view: EditorView, item: HTMLElement): number | null {
  let inner: number;
  try {
    inner = view.posAtDOM(item, 0);
  } catch {
    return null;
  }

  const $pos = view.state.doc.resolve(inner);

  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if ($pos.node(depth).type.name === 'list_item') return $pos.before(depth);
  }

  return null;
}

/**
 * Whether a click landed on the checkbox: in the item's leading gutter -- the
 * padding the pseudo-element is drawn in -- and on its first line, so a
 * wrapped label's later lines are ordinary text.
 */
function isInCheckbox(item: HTMLElement, event: MouseEvent): boolean {
  const rect = item.getBoundingClientRect();
  const styles = getComputedStyle(item);

  const gutter = Number.parseFloat(styles.paddingInlineStart) || 0;
  if (gutter <= 0) return false;

  const lineHeight = Number.parseFloat(styles.lineHeight) || rect.height;

  const withinGutter =
    styles.direction === 'rtl'
      ? event.clientX >= rect.right - gutter
      : event.clientX <= rect.left + gutter;

  return withinGutter && event.clientY <= rect.top + lineHeight;
}

const taskListPlugin = $prose(
  () =>
    new Plugin({
      key: new PluginKey('task-list'),
      props: {
        handleDOMEvents: {
          mousedown: (view, event) => {
            const node = event.target as Node | null;
            const element = node instanceof HTMLElement ? node : node?.parentElement;
            const item = element?.closest(TASK_SELECTOR) as HTMLElement | null;
            if (!item || !isInCheckbox(item, event)) return false;

            const pos = taskItemAt(view, item);
            if (pos === null) return false;

            const listItem = view.state.doc.nodeAt(pos);
            if (!listItem || listItem.attrs.checked === null) return false;

            // Prevents the caret from being placed in the gutter as well.
            event.preventDefault();
            view.dispatch(
              view.state.tr.setNodeMarkup(pos, undefined, {
                ...listItem.attrs,
                checked: !listItem.attrs.checked,
              }),
            );
            return true;
          },
        },
      },
    }),
);

export const taskList: MilkdownPlugin[] = [taskListPlugin].flat();
