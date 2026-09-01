import { useEffect } from 'react';
import type { MilkdownPlugin } from '@milkdown/kit/ctx';
import { keymap } from '@milkdown/kit/prose/keymap';
import type { MarkType, Node as PMNode } from '@milkdown/kit/prose/model';
import {
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
} from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import {
  $command,
  $mark,
  $prose,
  $remark,
} from '@milkdown/kit/utils';

import { attributeFromEvent } from '@/lib/editor/event-target';
import { useWorkspace } from '@/hooks/use-workspace';
import { resolveWikilink, useWikilinkIndex } from '@/lib/stores/wikilink-index';
import { openWikilink } from './actions';
import { findWikilinks, wikilinkAt } from './scan';
import { WIKILINK_MDAST_TYPE, remarkWikilink } from './syntax';
import {
  WIKILINK_CLOSE,
  WIKILINK_OPEN,
  WIKILINK_SOURCE,
  basename,
  basenameOffset,
  parseWikilinkTarget,
  stripExtension,
} from './target';

export const WIKILINK_MARK_TYPE = 'wikilink';
/** Marks the mark's own DOM, so pasted editor HTML round-trips. */
const MARK_ATTRIBUTE = 'data-wikilink';
/** Set on the collapsed label only: its presence is what makes a link clickable. */
const TARGET_ATTRIBUTE = 'data-wikilink-target';
const REFRESH_META = 'wikilink-refresh';

export const remarkWikilinkPlugin = $remark('wikilink', () => remarkWikilink);

/**
 * Wikilinks live in the document as their literal `[[target]]` source text,
 * tagged with this mark. Keeping the source in the document is what makes
 * editing a link ordinary text editing -- there is no node boundary to escape,
 * nothing to select as a unit, and no separate editing mode.
 *
 * The mark itself carries no state: it exists so the serializer can emit the
 * brackets verbatim instead of escaping them, and so links are trivially
 * identifiable without re-scanning text. It excludes every other mark, because
 * a link is a single unformatted run by definition.
 */
export const wikilinkMark = $mark(WIKILINK_MARK_TYPE, () => ({
  inclusive: false,
  excludes: '_',
  parseDOM: [{ tag: `span[${MARK_ATTRIBUTE}]` }],
  toDOM: () => ['span', { [MARK_ATTRIBUTE]: '' }, 0],
  parseMarkdown: {
    match: (node) => node.type === WIKILINK_MDAST_TYPE,
    runner: (state, node, markType) => {
      state.openMark(markType);
      state.addText(`${WIKILINK_OPEN}${node.value}${WIKILINK_CLOSE}`);
      state.closeMark(markType);
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === WIKILINK_MARK_TYPE,
    runner: (state, mark, node) => {
      const target = new RegExp(`^${WIKILINK_SOURCE}$`).exec(node.text ?? '');
      state.withMark(mark, WIKILINK_MDAST_TYPE, target?.[1] ?? '');
    },
  },
}));

/* -------------------------------------------------------------------------
 * Mark sync
 * ---------------------------------------------------------------------- */

function markedRanges(doc: PMNode, markType: MarkType) {
  const ranges: { from: number; to: number }[] = [];

  doc.descendants((node, pos) => {
    if (!node.isText || !markType.isInSet(node.marks)) return;
    const previous = ranges[ranges.length - 1];
    if (previous?.to === pos) previous.to = pos + node.nodeSize;
    else ranges.push({ from: pos, to: pos + node.nodeSize });
  });

  return ranges;
}

/** Marked stretches no longer covered by a well-formed link. */
function staleRanges(
  doc: PMNode,
  markType: MarkType,
  links: { from: number; to: number }[],
) {
  const stale: { from: number; to: number }[] = [];

  for (const range of markedRanges(doc, markType)) {
    let cursor = range.from;
    for (const link of links) {
      if (link.to <= range.from || link.from >= range.to) continue;
      if (link.from > cursor) stale.push({ from: cursor, to: link.from });
      cursor = Math.max(cursor, link.to);
    }
    if (cursor < range.to) stale.push({ from: cursor, to: range.to });
  }

  return stale;
}

/**
 * Keeps the mark aligned with the text after every edit, so a link typed by
 * hand, pasted, or broken by deleting a bracket ends up in the same state as
 * one that came from the file. This only ever adds and removes marks; the text
 * is never rewritten underneath the author.
 */
const wikilinkSync = $prose((ctx) => {
  const markType = wikilinkMark.type(ctx);

  return new Plugin({
    key: new PluginKey('wikilink-sync'),
    appendTransaction: (transactions, _oldState, state) => {
      if (!transactions.some((transaction) => transaction.docChanged)) {
        return null;
      }

      const links = findWikilinks(state.doc, markType);
      const tr = state.tr;

      for (const link of links)
        tr.addMark(link.from, link.to, markType.create());
      for (const range of staleRanges(state.doc, markType, links)) {
        tr.removeMark(range.from, range.to, markType);
      }

      return tr.steps.length > 0 ? tr : null;
    },
  });
});

/* -------------------------------------------------------------------------
 * Rendering
 * ---------------------------------------------------------------------- */

/**
 * Collapses each link to its file name unless the selection touches it, in
 * which case the raw source is shown so it can be edited in place. Because the
 * source is revealed whenever the cursor is near, the cursor can never end up
 * stranded inside a collapsed range.
 */
function buildDecorations(state: EditorState, markType: MarkType) {
  const index = useWikilinkIndex.getState();
  const { selection } = state;

  const decorations = findWikilinks(state.doc, markType).flatMap((link) => {
    const parts = parseWikilinkTarget(link.target);
    const { status } = parts.path
      ? resolveWikilink(parts.path, index)
      : ({ status: 'unresolved' } as const);
    const linkClass = `wikilink wikilink-${status}`;

    const targetFrom = link.from + WIKILINK_OPEN.length;
    const targetTo = link.to - WIKILINK_CLOSE.length;

    // What the collapsed link reads as. It has to be a contiguous slice of the
    // source, because the surrounding text is hidden by position rather than
    // replaced: an explicit `|alias` runs to the end of the target, and
    // otherwise the file name sits at a known offset into the path.
    const aliasAt = link.target.indexOf('|');
    const labelFrom =
      parts.suffix === null
        ? targetFrom + basenameOffset(parts.path)
        : targetFrom + aliasAt + 1;
    const label =
      parts.suffix === null
        ? stripExtension(basename(parts.path))
        : parts.suffix;
    const labelTo = labelFrom + label.length;

    const revealed = selection.from <= link.to && selection.to >= link.from;

    // A target with no file name to show (`[[notes/.md]]`) has nothing to
    // collapse to, so it stays in source form.
    if (revealed || labelTo === labelFrom) {
      return [
        Decoration.inline(link.from, targetFrom, { class: 'wikilink-bracket' }),
        Decoration.inline(targetFrom, targetTo, { class: linkClass }),
        Decoration.inline(targetTo, link.to, { class: 'wikilink-bracket' }),
      ];
    }

    return [
      Decoration.inline(link.from, labelFrom, { class: 'wikilink-hidden' }),
      Decoration.inline(labelFrom, labelTo, {
        class: linkClass,
        [TARGET_ATTRIBUTE]: link.target,
      }),
      Decoration.inline(labelTo, link.to, { class: 'wikilink-hidden' }),
    ];
  });

  return DecorationSet.create(state.doc, decorations);
}

function clickedTarget(event: MouseEvent): string | null {
  return attributeFromEvent(event, `[${TARGET_ATTRIBUTE}]`, TARGET_ATTRIBUTE);
}

const wikilinkDecorations = $prose((ctx) => {
  const markType = wikilinkMark.type(ctx);

  return new Plugin({
    key: new PluginKey('wikilink-decorations'),
    state: {
      init: (_, state) => buildDecorations(state, markType),
      apply(tr, previous, _oldState, state) {
        if (tr.docChanged || tr.selectionSet || tr.getMeta(REFRESH_META)) {
          return buildDecorations(state, markType);
        }
        return previous.map(tr.mapping, tr.doc);
      },
    },
    props: {
      decorations(state) {
        return this.getState(state);
      },
      handleDOMEvents: {
        mousedown: (_view, event) => {
          if (event.button !== 0 || event.altKey) return false;

          const target = clickedTarget(event);
          if (target === null) return false;

          event.preventDefault();
          return true;
        },
        click: (_view, event) => {
          if (event.button !== 0 || event.altKey) return false;

          const target = clickedTarget(event);
          if (target === null || !openWikilink(target)) return false;

          event.preventDefault();
          return true;
        },
      },
    },
    view: (editorView) => {
      // Resolution status comes from the workspace index, which finishes
      // building after the first render and changes as files come and go.
      const unsubscribe = useWikilinkIndex.subscribe(() => {
        if (editorView.isDestroyed) return;
        editorView.dispatch(editorView.state.tr.setMeta(REFRESH_META, true));
      });

      return { destroy: unsubscribe };
    },
  });
});

/* -------------------------------------------------------------------------
 * Authoring
 * ---------------------------------------------------------------------- */

/*
 * Bracket pairing for `[[` used to live here. It now comes from the generic
 * auto-pair rules in `lib/autopair`, which subsume it: typing `[` twice
 * produces `[[]]` on its own, and typing `]` steps over one closer at a time.
 * Keeping a wikilink-specific rule alongside the generic one produced `[[]]]`,
 * because both fired on the same keystroke.
 */

/**
 * Inserts a link around the selection, or an empty one with the cursor between
 * the brackets. The insertion point for a command palette entry, and for
 * autocomplete accepting a suggestion.
 */
export const insertWikilinkCommand = $command(
  'InsertWikilink',
  () => (target?: string) => (state, dispatch) => {
    const { from, to, empty } = state.selection;
    const text = target ?? (empty ? '' : state.doc.textBetween(from, to, ' '));

    const tr = state.tr.insertText(
      `${WIKILINK_OPEN}${text}${WIKILINK_CLOSE}`,
      from,
      to,
    );
    tr.setSelection(
      TextSelection.create(tr.doc, from + WIKILINK_OPEN.length + text.length),
    );

    dispatch?.(tr.scrollIntoView());
    return true;
  },
);

const wikilinkKeymap = $prose((ctx) => {
  const markType = wikilinkMark.type(ctx);

  return keymap({
    'Mod-Enter': (state) => {
      const link = wikilinkAt(state, markType, state.selection.from);
      return link ? openWikilink(link.target) : false;
    },
  });
});

export const wikilink: MilkdownPlugin[] = [
  remarkWikilinkPlugin,
  wikilinkMark,
  wikilinkSync,
  wikilinkDecorations,
  wikilinkKeymap,
  insertWikilinkCommand,
].flat();

/**
 * Keeps the workspace file index in step with the open workspace. Mount once
 * per workspace surface; concurrent callers share a single walk. Call
 * `useWikilinkIndex.getState().invalidate()` after creating, renaming or
 * deleting files to have it rebuild.
 */
export function useWikilinkIndexSync() {
  const workspaceRoot = useWorkspace((state) => state.path);

  useEffect(() => {
    if (!workspaceRoot) return;
    void useWikilinkIndex.getState().ensureBuilt(workspaceRoot);
  }, [workspaceRoot]);
}

export { activeWikilinkQuery, findWikilinks, wikilinkAt } from './scan';
export { openWikilink } from './actions';
export { wikilinkLabel } from './target';
export {
  resolveWikilink,
  shortestWikilinkTarget,
} from '@/lib/stores/wikilink-index';
