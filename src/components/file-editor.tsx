import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { EditorView, keymap } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { minimalSetup } from 'codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { defaultKeymap } from '@codemirror/commands';
import { ScrollArea } from './ui/scroll-area';
import { livePreviewPlugin } from '@/lib/live-preview';
import { GFM } from '@lezer/markdown';

type FileEditorProps = {
  path: string;
};

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

  // Create the CodeMirror instance once content is loaded
  useEffect(() => {
    if (content === null || !containerRef.current) return;

    viewRef.current?.destroy();

    const state = EditorState.create({
      doc: content,
      extensions: [
        minimalSetup,
        markdown({ extensions: [GFM] }),
        keymap.of(defaultKeymap),
        EditorView.lineWrapping,
        EditorView.theme({
          '&': { height: '100%' },
          '.cm-scroller': { overflow: 'auto' },
          '.cm-gutters': { display: 'none' },
        }),
        livePreviewPlugin,
        
      ],
    });

    viewRef.current = new EditorView({
      state,
      parent: containerRef.current,
    });

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
      <div ref={containerRef} className="cm-typeset w-full text-sm min-h-full" />
    </ScrollArea>
  );
}
