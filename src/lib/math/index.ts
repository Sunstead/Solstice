import type { MilkdownPlugin } from '@milkdown/kit/ctx';
import { InputRule } from '@milkdown/kit/prose/inputrules';
import type { MarkType } from '@milkdown/kit/prose/model';
import {
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
} from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import {
  $inputRule,
  $mark,
  $nodeSchema,
  $prose,
  $remark,
} from '@milkdown/kit/utils';

import { closestFromEvent } from '@/lib/editor/event-target';
import { findInlineMath } from './scan';
import { MATH_SOURCE_ATTRIBUTE, renderMathElement } from './render';
import {
  MATH_BLOCK_MDAST_TYPE,
  MATH_INLINE_MDAST_TYPE,
  remarkMath,
} from './syntax';
import { MATH_DELIMITER, MATH_INLINE_SOURCE } from './target';

export const MATH_INLINE_MARK_TYPE = 'math_inline';
export const MATH_BLOCK_NODE_TYPE = 'math_block';

const MARK_ATTRIBUTE = 'data-math-inline';
const BLOCK_ATTRIBUTE = 'data-math-block';

export const remarkMathPlugin = $remark('solsticeMath', () => remarkMath);

/**
 * Inline math lives in the document as its literal `$…$` source, tagged with
 * this mark -- exactly as wikilinks do, and for the same reasons: editing a
 * formula stays ordinary text editing, and the serializer can emit the dollars
 * verbatim instead of letting remark escape the backslashes inside them.
 */
export const mathInlineMark = $mark(MATH_INLINE_MARK_TYPE, () => ({
  inclusive: false,
  excludes: '_',
  parseDOM: [{ tag: `span[${MARK_ATTRIBUTE}]` }],
  toDOM: () => ['span', { [MARK_ATTRIBUTE]: '' }, 0],
  parseMarkdown: {
    match: (node) => node.type === MATH_INLINE_MDAST_TYPE,
    runner: (state, node, markType) => {
      state.openMark(markType);
      state.addText(`${MATH_DELIMITER}${node.value}${MATH_DELIMITER}`);
      state.closeMark(markType);
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === MATH_INLINE_MARK_TYPE,
    runner: (state, mark, node) => {
      const match = new RegExp(`^${MATH_INLINE_SOURCE}$`).exec(node.text ?? '');
      state.withMark(mark, MATH_INLINE_MDAST_TYPE, match?.[1] ?? '');
    },
  },
}));

/** Ranges carrying the mark, so stale ones can be found and dropped. */
function markedRanges(doc: import('@milkdown/kit/prose/model').Node, markType: MarkType) {
  const ranges: { from: number; to: number }[] = [];

  doc.descendants((node, pos) => {
    if (!node.isText) return;
    if (!markType.isInSet(node.marks)) return;
    ranges.push({ from: pos, to: pos + node.nodeSize });
  });

  return ranges;
}

/** Keeps the mark aligned with the text after every edit. */
const mathInlineSync = $prose((ctx) => {
  const markType = mathInlineMark.type(ctx);

  return new Plugin({
    key: new PluginKey('math-inline-sync'),
    appendTransaction: (transactions, _oldState, state) => {
      if (!transactions.some((transaction) => transaction.docChanged)) {
        return null;
      }

      const found = findInlineMath(state.doc, markType);
      const tr = state.tr;

      for (const match of found) tr.addMark(match.from, match.to, markType.create());

      for (const range of markedRanges(state.doc, markType)) {
        const covered = found.some(
          (match) => match.from <= range.from && match.to >= range.to,
        );
        if (!covered) tr.removeMark(range.from, range.to, markType);
      }

      return tr.steps.length > 0 ? tr : null;
    },
  });
});

/**
 * Renders each formula unless the selection touches it, in which case the raw
 * source is shown so it can be edited in place -- the wikilink treatment.
 * Because the source is revealed whenever the caret is near, the caret can
 * never end up stranded inside a collapsed range.
 */
function buildDecorations(state: EditorState, markType: MarkType) {
  const { selection } = state;

  const decorations = findInlineMath(state.doc, markType).flatMap((match) => {
    const revealed = selection.from <= match.to && selection.to >= match.from;

    if (revealed) {
      return [Decoration.inline(match.from, match.to, { class: 'math-inline-source' })];
    }

    return [
      Decoration.inline(match.from, match.to, { class: 'math-hidden' }),
      // The key is load-bearing: decorations rebuild on every selection
      // change, and without it ProseMirror would re-run KaTeX on every
      // arrow-key press instead of reusing the DOM it already has.
      Decoration.widget(match.to, () => renderMathElement(match.value, false), {
        key: `math:${match.value}`,
        side: 1,
        ignoreSelection: true,
        marks: [],
      }),
    ];
  });

  return DecorationSet.create(state.doc, decorations);
}

const mathInlineDecorations = $prose((ctx) => {
  const markType = mathInlineMark.type(ctx);
  const key = new PluginKey<DecorationSet>('math-inline-decorations');

  return new Plugin<DecorationSet>({
    key,
    state: {
      init: (_config, state) => buildDecorations(state, markType),
      apply: (tr, previous, _oldState, newState) =>
        tr.docChanged || tr.selectionSet
          ? buildDecorations(newState, markType)
          : previous.map(tr.mapping, tr.doc),
    },
    props: {
      decorations(state) {
        return key.getState(state);
      },
      handleDOMEvents: {
        /**
         * Clicking rendered output puts the caret in the source behind it.
         *
         * The rendered formula is a widget: it holds no document position, so
         * a click on it lands wherever the browser decides -- usually past the
         * formula entirely, which left the source collapsed and the click
         * looking inert. Resolving the widget's own position and selecting
         * inside the match is what makes rendered math directly editable.
         */
        mousedown: (view, event) => {
          const rendered = closestFromEvent(event, `[${MATH_SOURCE_ATTRIBUTE}]`);
          if (!rendered) return false;

          // Matched on the formula itself rather than on a resolved DOM
          // position: a widget holds no position of its own, so asking for one
          // is unreliable. The value is exact, and position is only needed to
          // disambiguate a document that repeats the same formula.
          const source = rendered.getAttribute(MATH_SOURCE_ATTRIBUTE) ?? '';
          const candidates = findInlineMath(view.state.doc, markType).filter(
            (match) => match.value === source,
          );
          if (candidates.length === 0) return false;

          let found = candidates[0];
          if (candidates.length > 1) {
            try {
              const anchor = view.posAtDOM(rendered, 0);
              found = candidates.reduce((best, match) =>
                Math.abs(match.to - anchor) < Math.abs(best.to - anchor)
                  ? match
                  : best,
              );
            } catch {
              // Keep the first; an exact duplicate is the same formula anyway.
            }
          }

          // Clicking the back half of a formula puts the caret at its end,
          // the front half at its start, so the caret lands roughly where it
          // was aimed rather than always jumping to one side.
          const box = rendered.getBoundingClientRect();
          const atEnd = event.clientX > box.left + box.width / 2;
          const target = atEnd ? found.to - 1 : found.from + 1;

          event.preventDefault();
          view.dispatch(
            view.state.tr
              .setSelection(TextSelection.create(view.state.doc, target))
              .scrollIntoView(),
          );
          view.focus();
          return true;
        },
      },
    },
  });
});

/**
 * Display math is a node rather than marked text: it spans lines, and there is
 * no useful way to keep a multi-line source inline in a paragraph. The whole
 * body is kept in one attribute so the round trip is exact by construction.
 */
export const mathBlockSchema = $nodeSchema(MATH_BLOCK_NODE_TYPE, () => ({
  // A real block, not an inline atom rendered block-shaped. `remarkMath`
  // lifts display math out of the paragraph micromark parses it into
  // precisely so this can be true: an uneditable full-width box inside an
  // inline formatting context gives the caret beside it no sane geometry --
  // it either jumps as text reflows or is drawn at the formula's full height.
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  defining: true,
  isolating: true,
  attrs: { value: { default: '', validate: 'string' } },
  parseDOM: [
    {
      tag: `div[${BLOCK_ATTRIBUTE}]`,
      getAttrs: (dom: HTMLElement | string) => ({
        value: (dom as HTMLElement).getAttribute(BLOCK_ATTRIBUTE) || '',
      }),
    },
  ],
  toDOM: (node) => ['div', { [BLOCK_ATTRIBUTE]: node.attrs.value }],
  parseMarkdown: {
    match: ({ type }) => type === MATH_BLOCK_MDAST_TYPE,
    runner: (state, node, type) => {
      state.addNode(type, { value: String(node.value ?? '') });
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === MATH_BLOCK_NODE_TYPE,
    runner: (state, node) => {
      state.addNode(MATH_BLOCK_MDAST_TYPE, undefined, undefined, {
        value: node.attrs.value,
      });
    },
  },
}));

/**
 * `$$…$$` typed on its own line becomes a block as soon as it is closed.
 *
 * The rule replaces the whole paragraph rather than a range inside it: the
 * node is block-level now, so it cannot be inserted into one.
 */
const mathBlockInputRule = $inputRule(
  (ctx) =>
    new InputRule(/^\$\$([^$\n]+)\$\$$/, (state, match, start, end) => {
      const $start = state.doc.resolve(start);
      const paragraph = $start.parent;

      // Only when the paragraph holds nothing but what was just typed.
      if (!paragraph.isTextblock || paragraph.content.size !== end - start) {
        return null;
      }

      const from = $start.before($start.depth);
      const to = from + paragraph.nodeSize;

      return state.tr.replaceWith(
        from,
        to,
        mathBlockSchema.type(ctx).create({ value: match[1] }),
      );
    }),
);

export const math: MilkdownPlugin[] = [
  remarkMathPlugin,
  mathInlineMark,
  mathInlineSync,
  mathInlineDecorations,
  mathBlockSchema,
  mathBlockInputRule,
].flat();
