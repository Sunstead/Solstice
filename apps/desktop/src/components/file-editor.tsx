import { useEffect, useState } from 'react';
import { commands, unwrap } from '@/lib/backend';

import { ScrollArea } from '@sunstead/ui/components/scroll-area';
import { MilkdownEditorWrapper } from './milkdown-editor';
import { SourceEditor } from './source-editor';
import { takeHandoff } from '@/lib/stores/editor-text';
import { ViewerHeader } from './viewer/viewer-header';
import { LinkEditor } from './link-editor';
import { TableTools } from './table-tools';

type FileEditorProps = {
  path: string;
  /** Raw markdown in CodeMirror rather than the rich editor. */
  source?: boolean;
};

export function FileEditor({ path, source = false }: FileEditorProps) {
  // Switching modes hands over the other editor's text, which is newer than
  // the file while its last save is on the way.
  const [handed] = useState(() => takeHandoff(path));
  const [content, setContent] = useState<string | null>(handed);
  const [error, setError] = useState<string | null>(null);

  // Load file content. FileView keys this by path, so it runs once.
  useEffect(() => {
    let cancelled = false;
    if (!path || handed !== null) return;

    unwrap(commands.readFile(path))
      .then((text) => {
        if (!cancelled) setContent(text);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [path, handed]);

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
      {/* Its end scrolls clear of the home indicator. */}
      <div className='flex flex-col min-h-full pb-[env(safe-area-inset-bottom)]'>
        <ViewerHeader path={path} sticky find />
        <div className='typeset w-full flex-1 flex flex-col relative'>
          {source ? (
            <SourceEditor path={path} initialContent={content} />
          ) : (
            <MilkdownEditorWrapper path={path} initialContent={content} />
          )}
          {/* Positions itself against the viewport, so it can live anywhere. */}
          <LinkEditor />
          <TableTools />
        </div>
      </div>
    </ScrollArea>
  );
}