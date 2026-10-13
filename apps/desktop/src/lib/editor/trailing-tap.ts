import type { Node } from '@milkdown/kit/prose/model';
import { Plugin, TextSelection } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';

/**
 * Whether the caret can't be put after `node` by clicking below it: a code
 * block (CodeMirror takes the click), a table, or a block with no text of
 * its own (an embed, a formula, a rule).
 */
export function endsInATrap(node: Node | null): boolean {
  if (!node) return false;
  return node.type.name === 'code_block' || node.type.name === 'table' || node.isAtom;
}

/**
 * A click or tap below the last block, when that block is one the caret
 * can't get past, makes an empty paragraph there to type in. Nothing is
 * added until then, so opening a note never changes it.
 */
export const trailingTap = $prose(
  () =>
    new Plugin({
      props: {
        handleDOMEvents: {
          // Pointer, not mouse: iOS sends no mousedown for a tap on the
          // editor's empty padding.
          pointerdown(view, event) {
            // Only the editor's own padding, under everything in it.
            if (event.target !== view.dom || !view.editable) return false;
            const { doc, schema } = view.state;
            const last = doc.lastChild;
            if (!endsInATrap(last) || !last) return false;
            const dom = view.nodeDOM(doc.content.size - last.nodeSize);
            if (!(dom instanceof HTMLElement)) return false;
            if (event.clientY <= dom.getBoundingClientRect().bottom) return false;

            const paragraph = schema.nodes.paragraph?.createAndFill();
            if (!paragraph) return false;
            const end = doc.content.size;
            const tr = view.state.tr.insert(end, paragraph);
            tr.setSelection(TextSelection.create(tr.doc, end + 1));
            view.dispatch(tr.scrollIntoView());
            view.focus();
            event.preventDefault();
            return true;
          },
        },
      },
    }),
);
