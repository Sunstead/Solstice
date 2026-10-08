import type { Ctx } from '@milkdown/kit/ctx';
import { commandsCtx } from '@milkdown/kit/core';
import { Plugin, PluginKey, type EditorState } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { insertHrCommand } from '@milkdown/kit/preset/commonmark';
import { insertTableCommand } from '@milkdown/kit/preset/gfm';
import { $prose } from '@milkdown/kit/utils';
import {
  Brackets,
  Heading1,
  Heading2,
  Heading3,
  Image,
  Info,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Quote,
  Sigma,
  SquareCode,
  Table,
} from 'lucide-react';
import { create } from 'zustand';

import { runCommand } from '@/lib/commands';
import { mathBlockSchema } from '@/lib/math';

export interface SlashItem {
  label: string;
  /** Other words it answers to. */
  keywords: string;
  icon: React.ComponentType<{ className?: string }>;
  run: (ctx: Ctx, view: EditorView) => void | Promise<void>;
}

const command = (id: Parameters<typeof runCommand>[0]) => () => runCommand(id);

export const SLASH_ITEMS: SlashItem[] = [
  { label: 'Heading 1', keywords: 'h1 title', icon: Heading1, run: command('edit.heading1') },
  { label: 'Heading 2', keywords: 'h2 subtitle', icon: Heading2, run: command('edit.heading2') },
  { label: 'Heading 3', keywords: 'h3', icon: Heading3, run: command('edit.heading3') },
  { label: 'Bullet list', keywords: 'ul unordered', icon: List, run: command('edit.bullet_list') },
  { label: 'Numbered list', keywords: 'ol ordered', icon: ListOrdered, run: command('edit.ordered_list') },
  { label: 'Task list', keywords: 'todo checkbox', icon: ListTodo, run: command('edit.task_list') },
  { label: 'Quote', keywords: 'blockquote', icon: Quote, run: command('edit.blockquote') },
  {
    label: 'Callout',
    keywords: 'note tip warning admonition',
    icon: Info,
    run: async (_ctx, view) => {
      await runCommand('edit.blockquote');
      view.dispatch(view.state.tr.insertText('[!note] '));
    },
  },
  { label: 'Code block', keywords: 'pre fence', icon: SquareCode, run: command('edit.code_block') },
  {
    label: 'Table',
    keywords: 'grid',
    icon: Table,
    run: (ctx) => void ctx.get(commandsCtx).call(insertTableCommand.key),
  },
  {
    label: 'Math',
    keywords: 'equation latex formula',
    icon: Sigma,
    run: (ctx, view) => {
      view.dispatch(view.state.tr.replaceSelectionWith(mathBlockSchema.type(ctx).create({ value: '' })));
    },
  },
  { label: 'Image', keywords: 'picture photo', icon: Image, run: command('edit.insert_image') },
  {
    label: 'Divider',
    keywords: 'hr rule line separator',
    icon: Minus,
    run: (ctx) => void ctx.get(commandsCtx).call(insertHrCommand.key),
  },
  { label: 'Link to note', keywords: 'wikilink', icon: Brackets, run: command('edit.insert_wikilink') },
];

export function filterSlashItems(query: string): SlashItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return SLASH_ITEMS;
  return SLASH_ITEMS.filter((item) =>
    `${item.label} ${item.keywords}`.toLowerCase().split(/\s+/).some((word) => word.startsWith(q)) ||
    item.label.toLowerCase().startsWith(q),
  );
}

/** What the open menu shows; one menu, for whichever editor has it. */
export interface SlashMenuState {
  view: EditorView | null;
  query: string;
  items: SlashItem[];
  index: number;
  /** Where the `/` is, in viewport coordinates. */
  at: { left: number; top: number; bottom: number } | null;
  choose: ((item: SlashItem) => void) | null;
}

const CLOSED: SlashMenuState = { view: null, query: '', items: [], index: 0, at: null, choose: null };

export const useSlashMenu = create<SlashMenuState>(() => CLOSED);

type Open = { from: number; query: string } | null;

const key = new PluginKey<Open>('slash-menu');

const isOpen = (state: EditorState) => key.getState(state) ?? null;

/**
 * `/` at the start of a line, or after a space, opens a menu of blocks to
 * insert; typing filters it, and the `/query` goes when one is chosen.
 */
export const slashMenu = $prose((ctx) => {
  const close = (view: EditorView) => view.dispatch(view.state.tr.setMeta(key, 'close'));

  const choose = (view: EditorView, item: SlashItem) => {
    const open = isOpen(view.state);
    if (!open) return;
    view.dispatch(view.state.tr.delete(open.from, view.state.selection.head).setMeta(key, 'close'));
    view.focus();
    void item.run(ctx, view);
  };

  return new Plugin<Open>({
    key,
    state: {
      init: () => null,
      apply(tr, prev, _old, state) {
        const meta = tr.getMeta(key) as 'close' | { from: number } | undefined;
        if (meta === 'close') return null;
        if (meta) return { from: meta.from, query: '' };
        if (!prev) return null;

        const from = tr.mapping.map(prev.from);
        const { selection } = state;
        if (!selection.empty || selection.head <= from) return null;
        if (state.doc.textBetween(from, from + 1) !== '/') return null;
        const query = state.doc.textBetween(from + 1, selection.head, '\n');
        if (query.includes('\n') || query.length > 24) return null;
        if (/\s/.test(query) && filterSlashItems(query).length === 0) return null;
        return { from, query };
      },
    },
    props: {
      handleTextInput(view, from, to, text) {
        if (text !== '/' || isOpen(view.state)) return false;
        const $from = view.state.doc.resolve(from);
        if (!$from.parent.isTextblock || $from.parent.type.spec.code) return false;
        const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '\uFFFC');
        if (before && !/\s$/.test(before)) return false;
        view.dispatch(view.state.tr.insertText('/', from, to).setMeta(key, { from }));
        return true;
      },
      handleKeyDown(view, event) {
        if (!isOpen(view.state)) return false;
        const menu = useSlashMenu.getState();
        const count = menu.items.length;
        if (event.key === 'Escape') {
          close(view);
          return true;
        }
        if (count === 0) return false;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          const step = event.key === 'ArrowDown' ? 1 : -1;
          useSlashMenu.setState({ index: (menu.index + step + count) % count });
          return true;
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          choose(view, menu.items[menu.index]);
          return true;
        }
        return false;
      },
    },
    view: (editorView) => ({
      update(view) {
        const open = isOpen(view.state);
        const menu = useSlashMenu.getState();
        if (!open || !view.hasFocus()) {
          if (menu.view === view) useSlashMenu.setState(CLOSED);
          return;
        }
        const same = menu.view === view && menu.query === open.query;
        const { left, top, bottom } = view.coordsAtPos(open.from);
        useSlashMenu.setState({
          view,
          query: open.query,
          items: filterSlashItems(open.query),
          index: same ? menu.index : 0,
          at: { left, top, bottom },
          choose: (item) => choose(view, item),
        });
      },
      destroy() {
        if (useSlashMenu.getState().view === editorView) useSlashMenu.setState(CLOSED);
      },
    }),
  });
});
