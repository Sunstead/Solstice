import { useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { openPath } from '@tauri-apps/plugin-opener';
import { FileQuestion } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { FileEditor } from '@/components/file-editor';
import { embedKind } from '@/lib/embed/kind';
import { basename } from '@/lib/wikilink/target';
import { cn } from '@/lib/utils';

/**
 * Chooses what a tab actually shows.
 *
 * Every tab used to render `FileEditor`, which reads its file as UTF-8 -- so
 * opening a `.png` from the explorer failed with a decode error rather than
 * showing the image. Classification reuses the embed table, so a file type
 * that can be embedded in a note can also be opened on its own.
 */
export const FileView: React.FC<{ path: string }> = ({ path }) => {
  switch (embedKind(path)) {
    case 'markdown':
      return <FileEditor path={path} />;
    case 'image':
      return <ImageViewer path={path} />;
    case 'video':
      return <MediaViewer path={path} kind='video' />;
    case 'audio':
      return <MediaViewer path={path} kind='audio' />;
    case 'pdf':
      return (
        <iframe
          src={convertFileSrc(path)}
          title={basename(path)}
          className='h-full w-full border-0 bg-muted'
        />
      );
    default:
      return <UnsupportedFile path={path} />;
  }
};

/** Fit-to-window by default; click to inspect at full size. */
const ImageViewer: React.FC<{ path: string }> = ({ path }) => {
  const [actualSize, setActualSize] = useState(false);

  return (
    <div
      className={cn(
        'flex h-full w-full bg-muted/30 p-4',
        actualSize ? 'overflow-auto' : 'items-center justify-center overflow-hidden',
      )}
    >
      <img
        src={convertFileSrc(path)}
        alt={basename(path)}
        onClick={() => setActualSize((value) => !value)}
        className={cn(
          'rounded-md',
          actualSize ? 'max-w-none cursor-zoom-out' : 'max-h-full max-w-full cursor-zoom-in',
        )}
      />
    </div>
  );
};

const MediaViewer: React.FC<{ path: string; kind: 'video' | 'audio' }> = ({
  path,
  kind,
}) => {
  const src = convertFileSrc(path);

  return (
    <div className='flex h-full w-full items-center justify-center bg-muted/30 p-4'>
      {kind === 'video' ? (
        <video src={src} controls className='max-h-full max-w-full rounded-md' />
      ) : (
        <audio src={src} controls className='w-full max-w-lg' />
      )}
    </div>
  );
};

const UnsupportedFile: React.FC<{ path: string }> = ({ path }) => (
  <div className='flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center'>
    <FileQuestion className='size-8 text-muted-foreground' />
    <div className='space-y-1'>
      <p className='text-sm font-medium'>{basename(path)}</p>
      <p className='text-sm text-muted-foreground'>
        Solstice can't preview this file type.
      </p>
    </div>
    <Button variant='outline' size='sm' onClick={() => void openPath(path)}>
      Open in default app
    </Button>
  </div>
);
