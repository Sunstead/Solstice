import type { MilkdownPlugin } from '@milkdown/kit/ctx';
import type { Node as PMNode } from '@milkdown/kit/prose/model';
import {
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
} from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { $mark, $prose, $remark } from '@milkdown/kit/utils';

import { calloutIcon, chevronIcon } from './icons';
import { CALLOUT_MDAST_TYPE, remarkCallout } from './syntax';
import { parseCallout, type CalloutMarker } from './types';

export const CALLOUT_MARK_TYPE = 'callout_marker';
const MARK_ATTRIBUTE = 'data-callout-marker';

export const remarkCalloutPlugin = $remark('solsticeCallout', () => remarkCallout);

/**
 * Carries the `[!type]` marker as literal text whose serialization we own.
 *
 * The mark adds nothing visually -- the decorations below do that. It exists
 * purely so the brackets survive a round trip: remark escapes a `[` opening
 * phrasing content, so unmarked marker text would be written back as
 * `\[!warning]` and the callout would be gone on reload.
 */
export const calloutMarkerMark = $mark(CALLOUT_MARK_TYPE, () => ({
  inclusive: false,
  excludes: '_',
  parseDOM: [{ tag: `span[${MARK_ATTRIBUTE}]` }],
  toDOM: () => ['span', { [MARK_ATTRIBUTE]: '' }, 0],
  parseMarkdown: {
    match: (node) => node.type === CALLOUT_MDAST_TYPE,
    runner: (state, node, markType) => {
      state.openMark(markType);
      state.addText(String(node.value ?? ''));
      state.closeMark(markType);
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === CALLOUT_MARK_TYPE,
    runner: (state, mark, node) => {
      state.withMark(mark, CALLOUT_MDAST_TYPE, node.text ?? '');
    },
  },
}));

const TOGGLE_FOLD = 'callout-toggle-fold';
const FOLD_ATTRIBUTE = 'data-callout-fold';

interface Found {
  /** Position of the blockquote node. */
  pos: number;
  node: PMNode;
  marker: CalloutMarker;
  /** Content start of the first paragraph. */
  titleFrom: number;
  /**
   * End of the callout's title, which is the end of the first *line* -- not
   * the end of the first paragraph.
   *
   * `> [!tip] Title` followed by `> Body` with no blank line between them is
   * one paragraph containing a soft break, and that is how people actually
   * write callouts. Treating the whole paragraph as the title would style the
   * body as a heading and leave folding with nothing to hide.
   */
  titleTo: number;
  /** Content end of the first paragraph. */
  bodyTo: number;
}

/**
 * A callout is an ordinary blockquote whose first paragraph opens with
 * `[!type]`. Nothing about the document changes -- no new node, no new mark --
 * so a callout serializes as the blockquote it has always been and stays
 * readable in any other markdown tool. All of this is presentation.
 */
function findCallouts(doc: PMNode): Found[] {
  const found: Found[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name !== 'blockquote') return;

    const first = node.firstChild;
    if (!first || first.type.name !== 'paragraph') return;

    const marker = parseCallout(first.textContent);
    if (!marker) return;

    // One position for the blockquote, one for the paragraph.
    const titleFrom = pos + 2;
    const bodyTo = titleFrom + first.content.size;

    // `remarkLineBreak` turns every soft break into a hardbreak node, so the
    // end of the first line is the first one of those.
    let titleTo = bodyTo;
    let offset = titleFrom;

    first.forEach((child) => {
      if (titleTo !== bodyTo) return;
      if (child.type.name === 'hardbreak') titleTo = offset;
      offset += child.nodeSize;
    });

    found.push({ pos, node, marker, titleFrom, titleTo, bodyTo });
  });

  return found;
}

type FoldState = Map<number, boolean>;

function isFolded(folds: FoldState, found: Found): boolean {
  return folds.get(found.pos) ?? found.marker.collapsed;
}

function buildDecorations(state: EditorState, folds: FoldState) {
  const decorations: Decoration[] = [];

  for (const found of findCallouts(state.doc)) {
    const { pos, node, marker } = found;
    const end = pos + node.nodeSize;
    const folded = marker.foldable && isFolded(folds, found);

    decorations.push(
      Decoration.node(pos, end, {
        class: `callout${folded ? ' is-folded' : ''}`,
        'data-callout': marker.type,
      }),
    );

    const markerFrom = found.titleFrom;
    const markerTo = markerFrom + marker.length;

    // The title is the first line only, so it is styled by range rather than
    // by selecting the first child in CSS -- the body frequently shares that
    // child with it.
    if (found.titleTo > markerTo) {
      decorations.push(
        Decoration.inline(markerTo, found.titleTo, { class: 'callout-title' }),
      );
    }

    // Folding hides the rest of the first paragraph as well as the blocks
    // after it; with no blank line between title and body, that remainder is
    // the entire body.
    if (folded && found.bodyTo > found.titleTo) {
      decorations.push(
        Decoration.inline(found.titleTo, found.bodyTo, { class: 'callout-hidden' }),
      );
    }

    // The icon replaces the marker visually. It is a widget rather than a CSS
    // pseudo-element so the fold control next to it can take a real click.
    decorations.push(
      Decoration.widget(
        markerFrom,
        () => {
          const host = document.createElement('span');
          host.className = 'callout-affordances';
          host.setAttribute('contenteditable', 'false');
          host.appendChild(calloutIcon(marker.type));

          if (marker.foldable) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'callout-fold';
            button.setAttribute(FOLD_ATTRIBUTE, String(pos));
            button.appendChild(chevronIcon());
            host.appendChild(button);
          }

          return host;
        },
        { key: `callout:${marker.type}:${marker.foldable}`, side: -1, marks: [] },
      ),
    );

    // The marker text is hidden rather than removed -- it is the source, and
    // it is revealed whenever the caret is inside the line, so it can always
    // be edited and the caret can never be stranded behind it.
    const { selection } = state;
    const revealed = selection.from <= markerTo && selection.to >= markerFrom;
    if (!revealed) {
      decorations.push(
        Decoration.inline(markerFrom, markerTo, { class: 'callout-marker-hidden' }),
      );
    }
  }

  return DecorationSet.create(state.doc, decorations);
}

interface PluginState {
  folds: FoldState;
  decorations: DecorationSet;
}

/**
 * Fold state deliberately never reaches the document.
 *
 * Writing it back would turn a UI toggle into a document edit, which the dirty
 * tracker would see and the autosaver would write -- collapsing a callout
 * would dirty the file. It lives in plugin state instead, remapped as the
 * document changes so it follows its callout around.
 */
const calloutPlugin = $prose(() => {
  const key = new PluginKey<PluginState>('callout');

  return new Plugin<PluginState>({
    key,
    state: {
      init: (_config, state) => {
        const folds: FoldState = new Map();
        return { folds, decorations: buildDecorations(state, folds) };
      },
      apply: (tr, previous, _oldState, newState) => {
        let folds = previous.folds;

        const toggle = tr.getMeta(TOGGLE_FOLD) as number | undefined;
        if (toggle !== undefined) {
          folds = new Map(folds);
          const found = findCallouts(newState.doc).find((c) => c.pos === toggle);
          folds.set(toggle, !(found ? isFolded(previous.folds, found) : false));
        } else if (tr.docChanged) {
          const remapped: FoldState = new Map();
          for (const [pos, value] of folds) {
            remapped.set(tr.mapping.map(pos), value);
          }
          folds = remapped;
        }

        if (!tr.docChanged && !tr.selectionSet && toggle === undefined) {
          return { folds, decorations: previous.decorations.map(tr.mapping, tr.doc) };
        }

        return { folds, decorations: buildDecorations(newState, folds) };
      },
    },
    props: {
      decorations(state) {
        return key.getState(state)?.decorations;
      },
      handleDOMEvents: {
        mousedown: (view, event) => {
          const pos = foldTargetOf(event);
          if (pos === null) return false;

          event.preventDefault();

          const tr = view.state.tr.setMeta(TOGGLE_FOLD, pos);
          const found = findCallouts(view.state.doc).find((c) => c.pos === pos);
          const folds = key.getState(view.state)?.folds;

          // Collapsing content the caret is sitting in would strand it in a
          // `display: none` region, where typing goes nowhere visible. Bring
          // it back to the end of the title first.
          if (found && folds && !isFolded(folds, found)) {
            const { from } = view.state.selection;
            const end = pos + found.node.nodeSize;

            if (from > found.titleTo && from < end) {
              tr.setSelection(TextSelection.create(tr.doc, found.titleTo));
            }
          }

          view.dispatch(tr);
          return true;
        },
      },
    },
  });
});

function foldTargetOf(event: MouseEvent): number | null {
  const node = event.target as Node | null;
  const element = node instanceof HTMLElement ? node : node?.parentElement;
  const raw = element?.closest(`[${FOLD_ATTRIBUTE}]`)?.getAttribute(FOLD_ATTRIBUTE);

  return raw === null || raw === undefined ? null : Number(raw);
}

/**
 * Keeps the mark on the marker text after every edit, so a callout typed by
 * hand serializes as faithfully as one that came from the file.
 */
const calloutMarkerSync = $prose((ctx) => {
  const markType = calloutMarkerMark.type(ctx);

  return new Plugin({
    key: new PluginKey('callout-marker-sync'),
    appendTransaction: (transactions, _oldState, state) => {
      if (!transactions.some((transaction) => transaction.docChanged)) {
        return null;
      }

      const wanted = findCallouts(state.doc).map(({ pos, marker }) => ({
        from: pos + 2,
        to: pos + 2 + marker.markerLength,
      }));

      const tr = state.tr;
      for (const range of wanted) tr.addMark(range.from, range.to, markType.create());

      state.doc.descendants((node, pos) => {
        if (!node.isText || !markType.isInSet(node.marks)) return;

        const from = pos;
        const to = pos + node.nodeSize;
        const covered = wanted.some(
          (range) => range.from <= from && range.to >= to,
        );

        if (!covered) tr.removeMark(from, to, markType);
      });

      return tr.steps.length > 0 ? tr : null;
    },
  });
});

export const callout: MilkdownPlugin[] = [
  remarkCalloutPlugin,
  calloutMarkerMark,
  calloutMarkerSync,
  calloutPlugin,
].flat();
