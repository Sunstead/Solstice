import {
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
  type Transaction,
} from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

import { findMatches, type FindMatch, type FindOptions } from './matches';

export const findPluginKey = new PluginKey<FindPluginState>('solstice-find');

type FindQuery = FindOptions & { query: string };

export type FindPluginState = FindQuery & {
  matches: FindMatch[];
  activeIndex: number;
  decorations: DecorationSet;
};

/** Sets the query/options. `null` clears the search entirely. */
type SetQueryMeta = { type: 'query'; value: FindQuery | null };
/** Moves the active match; the caller separately scrolls it into view. */
type StepMeta = { type: 'step'; direction: 1 | -1 };

type FindMeta = SetQueryMeta | StepMeta;

const EMPTY: FindQuery = { query: '', caseSensitive: false, wholeWord: false };

function decorate(matches: FindMatch[], activeIndex: number, doc: EditorState['doc']) {
  if (matches.length === 0) return DecorationSet.empty;

  return DecorationSet.create(
    doc,
    matches.map((match, index) =>
      Decoration.inline(match.from, match.to, {
        class:
          index === activeIndex
            ? 'find-match find-match-active'
            : 'find-match',
      }),
    ),
  );
}

function rescan(query: FindQuery, state: EditorState, preferredIndex: number): FindPluginState {
  const matches = findMatches(state.doc, query.query, query);
  const activeIndex =
    matches.length === 0 ? -1 : Math.min(Math.max(preferredIndex, 0), matches.length - 1);

  return {
    ...query,
    matches,
    activeIndex,
    decorations: decorate(matches, activeIndex, state.doc),
  };
}

export function getFindState(state: EditorState): FindPluginState | undefined {
  return findPluginKey.getState(state);
}

export function setFindQuery(view: EditorView, query: FindQuery | null) {
  view.dispatch(
    view.state.tr.setMeta(findPluginKey, { type: 'query', value: query } satisfies FindMeta),
  );
}

/**
 * Advances to the next/previous match, wrapping at either end, and puts the
 * selection on it so closing the bar leaves the caret where the user was
 * looking. A selection-only transaction has no `docChanged`, so this never
 * marks the buffer dirty or schedules a write.
 */
export function stepFindMatch(view: EditorView, direction: 1 | -1) {
  const tr = view.state.tr.setMeta(findPluginKey, {
    type: 'step',
    direction,
  } satisfies FindMeta);

  const current = getFindState(view.state);
  if (!current || current.matches.length === 0) {
    view.dispatch(tr);
    return;
  }

  const count = current.matches.length;
  const next = current.matches[(current.activeIndex + direction + count) % count];

  view.dispatch(
    tr
      .setSelection(TextSelection.create(tr.doc, next.from, next.to))
      .scrollIntoView(),
  );
}

/**
 * Highlights every match and tracks which one is current. Matches are
 * recomputed when the query changes and remapped -- not re-searched -- while
 * the document is only being edited around them, so highlights survive typing
 * without a scan per keystroke.
 */
export const findPlugin = $prose(
  () =>
    new Plugin<FindPluginState>({
      key: findPluginKey,
      state: {
        init: (_, state) => rescan(EMPTY, state, 0),

        apply: (tr: Transaction, previous, _oldState, newState) => {
          const meta = tr.getMeta(findPluginKey) as FindMeta | undefined;

          if (meta?.type === 'query') {
            return rescan(meta.value ?? EMPTY, newState, previous.activeIndex);
          }

          if (meta?.type === 'step') {
            if (previous.matches.length === 0) return previous;

            const count = previous.matches.length;
            const activeIndex =
              (previous.activeIndex + meta.direction + count) % count;

            return {
              ...previous,
              activeIndex,
              decorations: decorate(previous.matches, activeIndex, newState.doc),
            };
          }

          if (!tr.docChanged) return previous;

          // An edit can create or destroy matches, so a rescan is the only
          // honest answer -- but only for a document that is actually being
          // searched, which keeps ordinary typing off this path entirely.
          if (!previous.query) return previous;

          return rescan(previous, newState, previous.activeIndex);
        },
      },
      props: {
        decorations: (state) => findPluginKey.getState(state)?.decorations,
      },
    }),
);
