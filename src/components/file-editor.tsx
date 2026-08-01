import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { keymap } from 'prosemirror-keymap';
import { history, undo, redo } from 'prosemirror-history';
import { baseKeymap } from 'prosemirror-commands';
import {
  splitListItem,
  liftListItem,
  sinkListItem,
} from 'prosemirror-schema-list';
import {
  inputRules,
  wrappingInputRule,
  textblockTypeInputRule,
  smartQuotes,
  emDash,
  ellipsis,
  InputRule,
} from 'prosemirror-inputrules';
import {
  defaultMarkdownParser,
  defaultMarkdownSerializer,
  schema,
} from 'prosemirror-markdown';
import type { MarkType, NodeType } from 'prosemirror-model';
import { ScrollArea } from './ui/scroll-area';

type FileEditorProps = {
  path: string;
};

// --- Input rules -----------------------------------------------------

// Wraps text matching a mark pattern (e.g. **bold**, *italic*) in the
// given mark. Strips the matched delimiters from the final text.
function markInputRule(regexp: RegExp, markType: MarkType): InputRule {
  return new InputRule(regexp, (state, match, start, end) => {
    const { tr } = state;
    const m = match[1] ?? match[0];
    const markStart = start + match[0].indexOf(m);
    const markEnd = markStart + m.length;

    if (markEnd < end) tr.delete(markEnd, end);
    if (markStart > start) tr.delete(start, markStart);

    const newEnd = start + m.length;
    tr.addMark(start, newEnd, markType.create());
    tr.removeStoredMark(markType);
    return tr;
  });
}

function buildInputRules(schema: typeof defaultMarkdownParser.schema) {
  const rules: InputRule[] = [...smartQuotes, ellipsis, emDash];

  // # Heading, ## Heading, etc.
  rules.push(
    textblockTypeInputRule(
      /^(#{1,6})\s$/,
      schema.nodes.heading as NodeType,
      (match) => ({
        level: match[1].length,
      }),
    ),
  );

  // > Blockquote
  rules.push(
    wrappingInputRule(/^\s*>\s$/, schema.nodes.blockquote as NodeType),
  );

  // - or * bullet list
  rules.push(
    wrappingInputRule(/^\s*([-+*])\s$/, schema.nodes.bullet_list as NodeType),
  );

  // 1. ordered list
  rules.push(
    wrappingInputRule(
      /^(\d+)\.\s$/,
      schema.nodes.ordered_list as NodeType,
      (match) => ({ order: +match[1] }),
      (match, node) => node.childCount + node.attrs.order === +match[1],
    ),
  );

  // ``` fenced code block
  rules.push(
    textblockTypeInputRule(/^```$/, schema.nodes.code_block as NodeType),
  );

  // **bold** or __bold__
  rules.push(
    markInputRule(/(?:\*\*|__)([^*_]+)(?:\*\*|__)$/, schema.marks.strong),
  );

  // *italic* or _italic_
  rules.push(
    markInputRule(/(?:^|[^*_])(?:\*|_)([^*_]+)(?:\*|_)$/, schema.marks.em),
  );

  // `code`
  rules.push(markInputRule(/`([^`]+)`$/, schema.marks.code));

  return inputRules({ rules });
}

// --- Component ---------------------------------------------------------

export function FileEditor({ path }: FileEditorProps) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  // Load file content
  useEffect(() => {
    let cancelled = false;
    if (!path) return;

    invoke<string>('read_file', { path })
      .then((text) => {
        if (!cancelled) setContent(text);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [path]);

  // Create the ProseMirror instance once content is loaded
  useEffect(() => {
    if (content === null || !containerRef.current) return;

    viewRef.current?.destroy();

    const doc = defaultMarkdownParser.parse(content);

    const listKeymap = keymap({
      Enter: splitListItem(schema.nodes.list_item),
      'Mod-[': liftListItem(schema.nodes.list_item),
      'Mod-]': sinkListItem(schema.nodes.list_item),
      Tab: sinkListItem(schema.nodes.list_item),
      'Shift-Tab': liftListItem(schema.nodes.list_item),
    });

    const state = EditorState.create({
      doc,
      schema,
      plugins: [
        buildInputRules(schema),
        history(),
        keymap({ 'Mod-z': undo, 'Mod-y': redo, 'Mod-Shift-z': redo }),
        listKeymap,
        keymap(baseKeymap),
      ],
    });

    const view = new EditorView(containerRef.current, {
      state,
      // NOTE: fires on every keystroke — debounce before shipping.
      dispatchTransaction(tr) {
        const newState = view.state.apply(tr);
        view.updateState(newState);

        if (tr.docChanged) {
          const markdown = defaultMarkdownSerializer.serialize(newState.doc);
          invoke('write_file', { path, contents: markdown }).catch((err) =>
            setError(String(err)),
          );
        }
      },
    });
    viewRef.current = view;

    return () => {
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, [path, content]);

  if (error) {
    return (
      <div className='p-4 text-destructive'>
        Failed to load {path}: {error}
      </div>
    );
  }

  if (content === null) {
    return <div className='p-4 text-muted-foreground'>Loading…</div>;
  }

  return (
    <ScrollArea className='h-full'>
      <div ref={containerRef} className='typeset w-full text-sm h-full text-[16px]' />
    </ScrollArea>
  );
}
