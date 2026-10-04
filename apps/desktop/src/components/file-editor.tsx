import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

import { ScrollArea } from '@sunstead/ui/components/scroll-area';
import { MilkdownEditorWrapper } from './milkdown-editor';
import { ViewerHeader } from './viewer/viewer-header';
import { LinkEditor } from './link-editor';
import { TableTools } from './table-tools';

type FileEditorProps = {
  path: string;
};

export function FileEditor({ path }: FileEditorProps) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load file content
  useEffect(() => {
    let cancelled = false;
    setContent(null); // reset so a stale doc from the previous file never flashes
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
      <div className='flex flex-col min-h-full'>
        <ViewerHeader path={path} sticky find />
        <div className='typeset w-full flex-1 flex flex-col relative'>
          <MilkdownEditorWrapper
            path={path}
            initialContent={content}
            onError={setError}
          />
          {/* Positions itself against the viewport, so it can live anywhere. */}
          <LinkEditor />
          <TableTools />
        </div>
      </div>
    </ScrollArea>
  );
}