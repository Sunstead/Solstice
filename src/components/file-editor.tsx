import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

import { ScrollArea } from './ui/scroll-area';
import { MilkdownEditorWrapper } from './milkdown-editor';
import FileBreadcrumb from './file-breadcrumb';
import { FileActionsDropdown } from './file-actions-dropdown';
import { revealInExplorer } from '@/lib/entry-actions';
import { FindBar } from './find-bar';
import { LinkEditor } from './link-editor';
import { TableTools } from './table-tools';
import { useFindStore } from '@/lib/stores/find';

type FileEditorProps = {
  path: string;
};

export function FileEditor({ path }: FileEditorProps) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const findOpen = useFindStore((s) => s.openPath === path);

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
        <div className='sticky top-0 bg-background p-2 pr-4 grid grid-cols-[max-content_1fr_max-content] justify-items-center items-center z-10'>
          <div className='flex items-center'></div>
          <div className='flex items-center justify-center min-w-0 w-full justify-self-stretch'>
            <FileBreadcrumb
              filePath={path}
              className='min-w-0 max-w-full'
              onNavigate={(folder) => void revealInExplorer(folder)}
            />
          </div>
          <div className='flex items-center'>
            <FileActionsDropdown path={path} />
          </div>

          {/*
            Anchored to the header rather than to the scrolling content: the
            header is sticky, so it is the one box in here that never moves.
            A panel positioned against the document would slide up under it
            the moment the user scrolled. `top-full` then hangs it just below
            the header, clear of the actions button it would otherwise cover.
          */}
          {findOpen && (
            <div className='absolute top-full right-3 z-20 mt-1'>
              <FindBar onClose={() => useFindStore.getState().close()} />
            </div>
          )}
        </div>
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