import type { MilkdownPlugin } from '@milkdown/kit/ctx';
import { toggleMark } from '@milkdown/kit/prose/commands';
import { markRule } from '@milkdown/kit/prose';
import { $command, $inputRule, $markSchema, $remark } from '@milkdown/kit/utils';

import { HIGHLIGHT_MDAST_TYPE, remarkHighlight } from './syntax';

export const HIGHLIGHT_MARK_TYPE = 'highlight';

export const remarkHighlightPlugin = $remark('solsticeHighlight', () => remarkHighlight);

export const highlightSchema = $markSchema(HIGHLIGHT_MARK_TYPE, () => ({
  parseDOM: [{ tag: 'mark' }],
  toDOM: () => ['mark', { class: 'solstice-highlight' }, 0],
  parseMarkdown: {
    match: (node) => node.type === HIGHLIGHT_MDAST_TYPE,
    runner: (state, node, markType) => {
      state.openMark(markType);
      state.next(node.children);
      state.closeMark(markType);
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === HIGHLIGHT_MARK_TYPE,
    runner: (state, mark) => {
      state.withMark(mark, HIGHLIGHT_MDAST_TYPE);
    },
  },
}));

/** `==text==` typed becomes highlighted as the second `==` lands. */
const highlightInputRule = $inputRule((ctx) =>
  markRule(/(?<![=\w])==([^=\s](?:[^=]*[^=\s])?)==$/, highlightSchema.type(ctx)),
);

export const toggleHighlightCommand = $command('ToggleHighlight', (ctx) => () =>
  toggleMark(highlightSchema.type(ctx)),
);

/** All but the mark itself, which `editorOuterMarks` registers first. */
export const highlight: MilkdownPlugin[] = [
  remarkHighlightPlugin,
  highlightInputRule,
  toggleHighlightCommand,
].flat();
