import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

import { ScrollArea } from './ui/scroll-area';
import { MilkdownEditorWrapper } from './milkdown-editor';

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
      <div className='typeset w-full text-sm h-full text-[16px]'>
        <MilkdownEditorWrapper
          path={path}
          initialContent={content}
          onError={setError}
        />
      </div>
    </ScrollArea>
  );
}
