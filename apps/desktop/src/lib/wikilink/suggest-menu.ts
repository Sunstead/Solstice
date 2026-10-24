import { syntaxTree } from '@codemirror/language';
import { Prec, StateEffect, StateField, type EditorState as SourceState } from '@codemirror/state';
import { EditorView as SourceView, keymap, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { Plugin, PluginKey, TextSelection, type EditorState } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';
import { create } from 'zustand';

import { useWikilinkIndex } from '@/lib/stores/wikilink-index';
import {
  rankWikilinkTargets,
  stepSuggest,
  SUGGEST_CLOSED,
  suggestedLink,
  suggestEnd,
  wikilinkQuery,
  type SuggestAt,
  type SuggestState,
} from './suggest';

/** What the open menu shows; one menu, for whichever editor has it. */
export interface WikilinkMenuState {
  /** The editor view it's for. */
  owner: object | null;
  query: string;
  /** Workspace-relative paths, best first. */
  items: string[];
  index: number;
  /** Where the `[[` is, in viewport coordinates. */
  at: { left: number; top: number; bottom: number } | null;
  choose: ((path: string) => void) | null;
}

const CLOSED: WikilinkMenuState = { owner: null, query: '', items: [], index: 0, at: null, choose: null };

export const useWikilinkMenu = create<WikilinkMenuState>(() => CLOSED);

function publish(
  owner: object,
  open: SuggestAt | null,
  at: WikilinkMenuState['at'],
  choose: (path: string) => void,
) {
  const menu = useWikilinkMenu.getState();
  if (!open || !at) {
    if (menu.owner === owner) useWikilinkMenu.setState(CLOSED);
    return;
  }
  const same = menu.owner === owner && menu.query === open.query;
  useWikilinkMenu.setState({
    owner,
    query: open.query,
    items: rankWikilinkTargets(useWikilinkIndex.getState().byPath.values(), open.query),
    index: same ? menu.index : 0,
    at,
    choose,
  });
}

function unpublish(owner: object) {
  if (useWikilinkMenu.getState().owner === owner) useWikilinkMenu.setState(CLOSED);
}

/** The menu's keys, for whichever editor has it open: true when one was taken. */
function menuKey(key: string, close: () => void): boolean {
  const menu = useWikilinkMenu.getState();
  const count = menu.items.length;
  // Nothing shown: the key is the editor's.
  if (count === 0) return false;
  if (key === 'Escape') {
    close();
    return true;
  }
  if (key === 'ArrowDown' || key === 'ArrowUp') {
    const step = key === 'ArrowDown' ? 1 : -1;
    useWikilinkMenu.setState({ index: (menu.index + step + count) % count });
    return true;
  }
  if (key === 'Enter' || key === 'Tab') {
    menu.choose?.(menu.items[menu.index]);
    return true;
  }
  return false;
}

/* -------------------------------------------------------------------------
 * The rich editor
 * ---------------------------------------------------------------------- */

const key = new PluginKey<SuggestState>('wikilink-suggest');

function caretQuery(state: EditorState): SuggestAt | null {
  const { selection } = state;
  if (!selection.empty) return null;
  const { $head } = selection;
  if (!$head.parent.isTextblock || $head.parent.type.spec.code) return null;
  const before = $head.parent.textBetween(0, $head.parentOffset, undefined, '￼');
  const found = wikilinkQuery(before);
  return found && { from: $head.start() + found.offset, query: found.query };
}

/**
 * Typing `[[` suggests files to link; typing on filters them, and choosing
 * one writes its link in place of what was typed.
 */
export const wikilinkSuggest = $prose(() => {
  const close = (view: EditorView) => view.dispatch(view.state.tr.setMeta(key, 'close'));

  const choose = (view: EditorView, path: string) => {
    const open = key.getState(view.state)?.open;
    if (!open) return;
    const { $head, head } = view.state.selection;
    const after = $head.parent.textBetween($head.parentOffset, Math.min($head.parent.content.size, $head.parentOffset + 2));
    const link = suggestedLink(path, useWikilinkIndex.getState());
    const tr = view.state.tr.insertText(link, open.from, suggestEnd(head, after));
    tr.setSelection(TextSelection.create(tr.doc, open.from + link.length));
    view.dispatch(tr.scrollIntoView());
    view.focus();
  };

  return new Plugin<SuggestState>({
    key,
    state: {
      init: () => SUGGEST_CLOSED,
      apply: (tr, prev, _old, state) =>
        stepSuggest(prev, {
          at: caretQuery(state),
          docChanged: tr.docChanged,
          close: tr.getMeta(key) === 'close',
          map: (pos) => tr.mapping.map(pos),
        }),
    },
    props: {
      handleKeyDown(view, event) {
        if (!key.getState(view.state)?.open) return false;
        return menuKey(event.key, () => close(view));
      },
    },
    view: (editorView) => ({
      update(view) {
        const open = view.hasFocus() ? (key.getState(view.state)?.open ?? null) : null;
        publish(view, open, open && view.coordsAtPos(open.from), (path) => choose(view, path));
      },
      destroy: () => unpublish(editorView),
    }),
  });
});

/* -------------------------------------------------------------------------
 * Source mode
 * ---------------------------------------------------------------------- */

const closeSuggest = StateEffect.define<null>();

const CODE = new Set(['FencedCode', 'CodeBlock', 'InlineCode', 'CodeText']);

function sourceCaretQuery(state: SourceState): SuggestAt | null {
  const { main } = state.selection;
  if (!main.empty) return null;
  const line = state.doc.lineAt(main.head);
  const found = wikilinkQuery(line.text.slice(0, main.head - line.from));
  if (!found) return null;
  // Code is code, in fences or backticks.
  for (let node = syntaxTree(state).resolveInner(main.head, -1); ; node = node.parent) {
    if (CODE.has(node.name)) return null;
    if (!node.parent) break;
  }
  return { from: line.from + found.offset, query: found.query };
}

const suggestField = StateField.define<SuggestState>({
  create: () => SUGGEST_CLOSED,
  update: (prev, tr) =>
    stepSuggest(prev, {
      at: sourceCaretQuery(tr.state),
      docChanged: tr.docChanged,
      close: tr.effects.some((e) => e.is(closeSuggest)),
      map: (pos) => tr.changes.mapPos(pos),
    }),
});

function sourceChoose(view: SourceView, path: string) {
  const open = view.state.field(suggestField).open;
  if (!open) return;
  const { head } = view.state.selection.main;
  const link = suggestedLink(path, useWikilinkIndex.getState());
  view.dispatch({
    changes: { from: open.from, to: suggestEnd(head, view.state.sliceDoc(head, head + 2)), insert: link },
    selection: { anchor: open.from + link.length },
    userEvent: 'input.complete',
    scrollIntoView: true,
  });
  view.focus();
}

const sourcePublisher = ViewPlugin.fromClass(
  class {
    constructor(readonly view: SourceView) {}

    update(update: ViewUpdate) {
      const open = update.view.hasFocus ? update.state.field(suggestField).open : null;
      if (!open) return unpublish(this.view);
      // Layout can't be read mid-update. The state is read again when it
      // can be, since the menu may have closed in between.
      this.view.requestMeasure({
        key: this,
        read: (view) => {
          const now = view.hasFocus ? view.state.field(suggestField).open : null;
          return now && { open: now, at: view.coordsAtPos(now.from) };
        },
        write: (measured) =>
          publish(this.view, measured?.open ?? null, measured?.at ?? null, (path) => sourceChoose(this.view, path)),
      });
    }

    destroy() {
      unpublish(this.view);
    }
  },
);

const sourceKeys = Prec.highest(
  keymap.of(
    ['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].map((name) => ({
      key: name,
      run: (view: SourceView) =>
        view.state.field(suggestField).open !== null &&
        menuKey(name, () => view.dispatch({ effects: closeSuggest.of(null) })),
    })),
  ),
);

/** The `[[` suggestions in source mode. */
export const sourceWikilinkSuggest = [suggestField, sourcePublisher, sourceKeys];
