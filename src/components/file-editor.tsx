import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

import { ScrollArea } from './ui/scroll-area';
import { MilkdownEditorWrapper } from './milkdown-editor';
import FileBreadcrumb from './file-breadcrumb';
import { FileActionsDropdown } from './file-actions-dropdown';

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
      <div className='flex flex-col h-max min-h-full'>
        <div className='sticky top-0 bg-background p-2 pr-4 grid grid-cols-[max-content_1fr_max-content] justify-items-center items-center'>
          <div className='flex items-center'></div>
          <div className='flex items-center justify-center min-w-0 w-full justify-self-stretch'>
            <FileBreadcrumb filePath={path} className='min-w-0 max-w-full' />
          </div>
          <div className='flex items-center'>
            <FileActionsDropdown />
          </div>
        </div>
        <div className='typeset w-full text-sm flex-1 min-h-0 text-[16px]'>
          <MilkdownEditorWrapper
            path={path}
            initialContent={content}
            onError={setError}
          />
        </div>
      </div>
    </ScrollArea>
  );
}
