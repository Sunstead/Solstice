/**
 * The caret at a block's edges (R5): code, math, tables, front matter, rules,
 * and images or embeds on a line of their own.
 *
 * - Backspace or Delete next to one selects it; the next press deletes it.
 * - Backspace at a code block's start makes it paragraphs, one per line.
 * - Arrows step in and out, and stepping out past the first or last block
 *   makes a line to type on.
 *
 * Code and math blocks' own editors leave through `leaveBlock` too.
 */
import type { Node as PMNode, ResolvedPos } from '@milkdown/kit/prose/model';
import { NodeSelection, Plugin, PluginKey, Selection, TextSelection, type Command, type EditorState } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';

const MEDIA = new Set(['image', 'wiki_embed']);

/**
 * Whether the caret can't be put after `node` by clicking below it: a code
 * block (CodeMirror takes the click), a table, or a block with no text of
 * its own (an embed, a formula, a rule).
 */
export function endsInATrap(node: PMNode | null): boolean {
  if (!node) return false;
  return node.type.name === 'code_block' || node.type.name === 'table' || node.isAtom;
}

/** The image or embed a paragraph holds and nothing else. */
function mediaOf(node: PMNode): PMNode | null {
  if (node.type.name !== 'paragraph' || node.childCount !== 1) return null;
  return MEDIA.has(node.firstChild!.type.name) ? node.firstChild : null;
}

/** Where to select a block at `pos`, if it's one the caret stops at whole. */
function edgeTarget(node: PMNode, pos: number): number | null {
  if (node.isBlock && endsInATrap(node)) return pos;
  return mediaOf(node) ? pos + 1 : null;
}

/** The block selected whole, with the range to delete it by. */
function selectedBlock(state: EditorState): { from: number; to: number } | null {
  const { selection } = state;
  if (!(selection instanceof NodeSelection)) return null;
  const { node, $from } = selection;
  if (node.isBlock) return endsInATrap(node) ? { from: selection.from, to: selection.to } : null;
  if (!MEDIA.has(node.type.name) || !mediaOf($from.parent)) return null;
  return { from: $from.before(), to: $from.after() };
}

/** The sibling just before (-1) or after (1) the caret's textblock, and where it is. */
function neighbour($caret: ResolvedPos, dir: -1 | 1): { node: PMNode; pos: number } | null {
  const depth = $caret.depth - 1;
  if (depth < 0) return null;
  const parent = $caret.node(depth);
  const index = $caret.index(depth) + dir;
  if (index < 0 || index >= parent.childCount) return null;
  const node = parent.child(index);
  return { node, pos: dir < 0 ? $caret.before() - node.nodeSize : $caret.after() };
}

function select(state: EditorState, pos: number) {
  return state.tr.setSelection(NodeSelection.create(state.doc, pos)).scrollIntoView();
}

/** Deletes the selected block, the caret going on the way it was going. */
function deleteBlock(dir: -1 | 1): Command {
  return (state, dispatch) => {
    const range = selectedBlock(state);
    if (!range) return false;
    if (!dispatch) return true;
    const tr = state.tr;
    const $range = state.doc.resolve(range.from);
    if ($range.parent.childCount === 1 && $range.parent.type.contentMatch.defaultType) {
      // A container can't be left empty: a line stands in.
      tr.replaceWith(range.from, range.to, state.schema.nodes.paragraph.create());
      tr.setSelection(TextSelection.create(tr.doc, range.from + 1));
    } else {
      tr.delete(range.from, range.to);
      const $at = tr.doc.resolve(range.from);
      const near = Selection.findFrom($at, -dir, true) ?? Selection.findFrom($at, dir, true) ?? Selection.near($at);
      tr.setSelection(near);
    }
    dispatch(tr.scrollIntoView());
    return true;
  };
}

/** A code block's lines as paragraphs, the caret at the first's start. */
export function codeToParagraphs(pos: number): Command {
  return (state, dispatch) => {
    const node = state.doc.nodeAt(pos);
    const paragraph = state.schema.nodes.paragraph;
    if (node?.type.name !== 'code_block' || !paragraph) return false;
    if (!dispatch) return true;
    const lines = node.textContent.split('\n').map((line) => paragraph.create(null, line ? state.schema.text(line) : null));
    const tr = state.tr.replaceWith(pos, pos + node.nodeSize, lines);
    tr.setSelection(TextSelection.create(tr.doc, pos + 1));
    dispatch(tr.scrollIntoView());
    return true;
  };
}

/**
 * Backspace (-1) or Delete (1) at a block's edge: selects the block (an empty
 * line between goes first), or deletes one already selected.
 */
export function blockEdgeDelete(dir: -1 | 1): Command {
  return (state, dispatch) => {
    if (deleteBlock(dir)(state, dispatch)) return true;
    const { selection } = state;
    if (!(selection instanceof TextSelection) || !selection.$cursor) return false;
    const $caret = selection.$cursor;
    const atEdge = dir < 0 ? $caret.parentOffset === 0 : $caret.parentOffset === $caret.parent.content.size;

    if (dir < 0 && atEdge && $caret.parent.type.name === 'code_block') {
      return codeToParagraphs($caret.before())(state, dispatch);
    }

    // An image or embed on its own line, the caret beside it.
    if (mediaOf($caret.parent)) {
      const atom = dir < 0 ? $caret.nodeBefore : $caret.nodeAfter;
      if (!atom || !MEDIA.has(atom.type.name)) return false;
      dispatch?.(select(state, dir < 0 ? $caret.pos - 1 : $caret.pos));
      return true;
    }

    if (!atEdge || $caret.parent.type.spec.code) return false;
    const next = neighbour($caret, dir);
    const target = next && edgeTarget(next.node, next.pos);
    if (target == null) return false;
    if (!dispatch) return true;
    if ($caret.parent.content.size === 0 && $caret.parent.type.name === 'paragraph') {
      const tr = state.tr.delete($caret.before(), $caret.after());
      const at = dir < 0 ? target : target - $caret.parent.nodeSize;
      dispatch(tr.setSelection(NodeSelection.create(tr.doc, at)).scrollIntoView());
      return true;
    }
    dispatch(select(state, target));
    return true;
  };
}

/**
 * Leaves the block at `pos` the way `dir` points: to the nearest place on
 * that side, or a new paragraph when there's none. Nothing goes above front
 * matter, so leaving it upwards stays put.
 */
export function leaveBlock(pos: number, dir: -1 | 1): Command {
  return (state, dispatch) => {
    const node = state.doc.nodeAt(pos);
    if (!node) return false;
    const boundary = dir < 0 ? pos : pos + node.nodeSize;
    const near = Selection.findFrom(state.doc.resolve(boundary), dir);
    if (near && (dir < 0 ? near.to <= pos : near.from >= pos + node.nodeSize)) {
      dispatch?.(state.tr.setSelection(near).scrollIntoView());
      return true;
    }
    if (dir < 0 && node.type.name === 'frontmatter') return true;
    const paragraph = state.schema.nodes.paragraph?.createAndFill();
    if (!paragraph) return false;
    if (!dispatch) return true;
    const tr = state.tr.insert(boundary, paragraph);
    tr.setSelection(TextSelection.create(tr.doc, boundary + 1));
    dispatch(tr.scrollIntoView());
    return true;
  };
}

/**
 * Arrows at a block: from a selected one, out; from the line beside one,
 * in (selected whole, or into its text). Up and Down from a line are the
 * browser's, which knows where the line ends.
 */
export function blockEdgeArrow(dir: -1 | 1, vertical: boolean): Command {
  return (state, dispatch) => {
    const { selection } = state;
    if (selection instanceof NodeSelection && selection.node.isBlock) {
      if (!endsInATrap(selection.node)) return false;
      return leaveBlock(selection.from, dir)(state, dispatch);
    }
    if (vertical || !(selection instanceof TextSelection) || !selection.$cursor) return false;
    const $caret = selection.$cursor;
    const atEdge = dir < 0 ? $caret.parentOffset === 0 : $caret.parentOffset === $caret.parent.content.size;
    if (!atEdge) return false;
    const next = neighbour($caret, dir);
    if (!next || !next.node.isBlock || !endsInATrap(next.node)) return false;
    const into = Selection.findFrom(state.doc.resolve(dir < 0 ? $caret.before() : $caret.after()), dir);
    if (!into) return false;
    dispatch?.(state.tr.setSelection(into).scrollIntoView());
    return true;
  };
}

const ARROWS: Record<string, [-1 | 1, boolean]> = {
  ArrowLeft: [-1, false],
  ArrowRight: [1, false],
  ArrowUp: [-1, true],
  ArrowDown: [1, true],
};

export const blockEdges = $prose(
  () =>
    new Plugin({
      key: new PluginKey('block-edges'),
      props: {
        handleKeyDown(view, event) {
          const arrow = ARROWS[event.key];
          if (!arrow || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return false;
          return blockEdgeArrow(...arrow)(view.state, view.dispatch);
        },
      },
    }),
);
