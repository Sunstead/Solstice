import type { MilkdownPlugin } from '@milkdown/kit/ctx';
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

const REFERENCE = 'footnote_reference';
const DEFINITION = 'footnote_definition';

/**
 * Makes a footnote reference jump to its definition.
 *
 * The gfm preset already parses and renders both halves; what it does not do
 * is connect them, so a `[^1]` was a dead superscript. Everything here is
 * navigation -- no schema and no serialization is involved.
 */
function jumpToDefinition(view: EditorView, label: string): boolean {
  let target: number | null = null;

  view.state.doc.descendants((node, pos) => {
    if (target !== null) return false;
    if (node.type.name === DEFINITION && node.attrs.label === label) target = pos;
    return true;
  });

  if (target === null) return false;

  const selection = TextSelection.near(view.state.doc.resolve(target + 1));
  view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
  view.focus();

  return true;
}

const footnotePlugin = $prose(
  () =>
    new Plugin({
      key: new PluginKey('footnote-navigation'),
      props: {
        handleDOMEvents: {
          mousedown: (_view, event) => labelOf(event) !== null,
          click: (view, event) => {
            const label = labelOf(event);
            if (label === null) return false;

            event.preventDefault();
            return jumpToDefinition(view, label);
          },
        },
      },
    }),
);

function labelOf(event: MouseEvent): string | null {
  const node = event.target as Node | null;
  const element = node instanceof HTMLElement ? node : node?.parentElement;

  return (
    element?.closest(`sup[data-type="${REFERENCE}"]`)?.getAttribute('data-label') ??
    null
  );
}

export const footnote: MilkdownPlugin[] = [footnotePlugin].flat();
