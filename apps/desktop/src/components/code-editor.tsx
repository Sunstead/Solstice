import { useEffect, useState } from 'react';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, foldGutter, foldKeymap, indentOnInput } from '@codemirror/language';
import { search, searchKeymap } from '@codemirror/search';
import { Compartment } from '@codemirror/state';
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view';

import { useCodeMirrorFile } from '@/hooks/use-codemirror-file';
import { languageForFile, loadLanguage } from '@/lib/codeblock/languages';
import { createSearchPanel } from '@/lib/codeblock/search-panel';
import { codeBlockHighlighting } from '@/lib/codeblock/theme';
import { sourceCaretClearance } from '@/lib/editor/caret-clearance';
import { useSetting } from '@/lib/settings/store';

/** A code file fills its pane, gutters on the pane's colour. */
const codeTheme = EditorView.theme({
  '&': { height: '100%', color: 'var(--foreground)', backgroundColor: 'transparent' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--editor-font-mono, var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace))',
    fontVariantLigatures: 'var(--editor-mono-ligatures, normal)',
    fontSize: '0.875rem',
    lineHeight: '1.6',
  },
  '.cm-content': {
    padding: '0.5rem 0 calc(env(safe-area-inset-bottom) + 4rem)',
    caretColor: 'var(--foreground)',
  },
  '.cm-line': { padding: '0 1rem 0 0.5rem' },
  '.cm-gutters': {
    backgroundColor: 'var(--background)',
    color: 'color-mix(in oklch, var(--muted-foreground) 60%, transparent)',
    border: 'none',
    paddingLeft: '0.5rem',
  },
  '.cm-activeLine': { backgroundColor: 'color-mix(in oklch, var(--foreground) 4%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--muted-foreground)' },
  '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--foreground)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
    backgroundColor: 'color-mix(in oklch, var(--primary) 25%, transparent)',
  },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in oklch, var(--primary) 25%, transparent)' },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'color-mix(in oklch, var(--primary) 55%, transparent)',
  },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
    backgroundColor: 'color-mix(in oklch, var(--primary) 20%, transparent)',
    outline: 'none',
  },
  '.cm-panels': { backgroundColor: 'var(--background)', border: 'none', padding: '0 0.5rem' },
  '.cm-foldGutter .cm-gutterElement': { padding: '0 0.25rem', cursor: 'pointer' },
});

type CodeEditorProps = {
  path: string;
  initialContent: string;
  /** A language by name, `''` for plain text; by default the file's own. */
  language?: string;
};

/**
 * A code or text file in CodeMirror. It saves whole, so sync's last writer
 * wins, and a dirty buffer asks on a change from outside.
 */
export function CodeEditor({ path, initialContent, language }: CodeEditorProps) {
  const name = language ?? languageForFile(path, initialContent)?.name ?? '';
  const numbered = useSetting('editor.codeLineNumbers');
  const wrapped = useSetting('code.wrapLines');
  const [parts] = useState(() => ({
    language: new Compartment(),
    numbers: new Compartment(),
    wrap: new Compartment(),
  }));

  const { attach, view, bars } = useCodeMirrorFile({
    path,
    initialContent,
    merges: false,
    extensions: () => [
      parts.numbers.of(numbered ? lineNumbers() : []),
      parts.wrap.of(wrapped ? EditorView.lineWrapping : []),
      parts.language.of([]),
      foldGutter(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      history(),
      bracketMatching(),
      closeBrackets(),
      indentOnInput(),
      // Ahead of the default keymap, so Backspace removes both halves of a pair.
      keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...searchKeymap, ...foldKeymap, indentWithTab]),
      codeBlockHighlighting,
      codeTheme,
      EditorView.contentAttributes.of({
        'data-command-surface': 'true',
        spellcheck: 'false',
        autocapitalize: 'off',
        autocorrect: 'off',
      }),
      search({ createPanel: createSearchPanel, top: true }),
      sourceCaretClearance,
    ],
  });

  useEffect(() => {
    if (!view) return;
    let cancelled = false;
    void loadLanguage(name).then((support) => {
      if (!cancelled) view.dispatch({ effects: parts.language.reconfigure(support ?? []) });
    });
    return () => {
      cancelled = true;
    };
  }, [view, name, parts]);

  useEffect(() => {
    view?.dispatch({
      effects: [
        parts.numbers.reconfigure(numbered ? lineNumbers() : []),
        parts.wrap.reconfigure(wrapped ? EditorView.lineWrapping : []),
      ],
    });
  }, [view, numbered, wrapped, parts]);

  return (
    <>
      {bars}
      <div ref={attach} className='solstice-code min-h-0 flex-1' data-language={name} />
    </>
  );
}
