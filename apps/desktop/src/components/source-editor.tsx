import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { search, searchKeymap } from '@codemirror/search';
import { EditorView, keymap } from '@codemirror/view';

import { useCodeMirrorFile } from '@/hooks/use-codemirror-file';
import { createSearchPanel } from '@/lib/codeblock/search-panel';
import { sourceCaretClearance } from '@/lib/editor/caret-clearance';
import { codeBlockHighlighting } from '@/lib/codeblock/theme';
import { sourceWikilinkSuggest } from '@/lib/wikilink/suggest-menu';

/** Markdown as written: the note's own fonts, syntax tinted, lines wrapped. */
const sourceTheme = EditorView.theme({
  '&': { color: 'var(--foreground)', backgroundColor: 'transparent', fontSize: 'inherit' },
  '&.cm-focused': { outline: 'none' },
  // CodeMirror's base theme sets monospace here.
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: 'inherit' },
  // The rich editor's column and margins (prosemirror.css), so switching
  // doesn't move the text.
  '.cm-content': {
    padding: '4rem 0 var(--editor-pad-bottom, 10rem)',
    caretColor: 'var(--foreground)',
  },
  '.cm-content, .cm-panels-top': {
    paddingLeft: 'max(1rem, calc((100% - var(--editor-measure, 80ch)) / 2))',
    paddingRight: 'max(1rem, calc((100% - var(--editor-measure, 80ch)) / 2))',
  },
  '.cm-line': { padding: '0' },
  '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--foreground)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
    backgroundColor: 'color-mix(in oklch, var(--primary) 25%, transparent)',
  },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in oklch, var(--primary) 25%, transparent)' },
  '.cm-panels': { backgroundColor: 'transparent', border: 'none' },
});

const extensions = () => [
  history(),
  sourceWikilinkSuggest,
  keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
  markdown({ codeLanguages: languages }),
  codeBlockHighlighting,
  sourceTheme,
  EditorView.lineWrapping,
  EditorView.contentAttributes.of({ 'data-command-surface': 'true', spellcheck: 'true' }),
  search({ createPanel: createSearchPanel, top: true }),
  sourceCaretClearance,
];

/**
 * A note as raw markdown, in CodeMirror: every character as it is in the file,
 * for whatever the rich editor can't show or would normalize. Saving, sync and
 * changes on disk work exactly as they do there.
 */
export function SourceEditor({ path, initialContent }: { path: string; initialContent: string }) {
  const { attach, bars } = useCodeMirrorFile({ path, initialContent, extensions, merges: true });
  return (
    <>
      {bars}
      <div ref={attach} className='solstice-source flex-1' />
    </>
  );
}
