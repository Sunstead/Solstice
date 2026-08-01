import { useEffect, useState } from 'react';
import { readTextFile } from '@tauri-apps/plugin-fs';

type FileEditorProps = {
  path: string;
};

export function FileEditor({ path }: FileEditorProps) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!path) return;

    readTextFile(path)
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
    return <div className='p-4 text-destructive'>Failed to load {path}: {error}</div>;
  }

  if (content === null) {
    return <div className='p-4 text-muted-foreground'>Loading…</div>;
  }

  return (
    <pre className='p-4 h-full w-full overflow-auto text-sm whitespace-pre-wrap'>
      {content}
    </pre>
  );
}