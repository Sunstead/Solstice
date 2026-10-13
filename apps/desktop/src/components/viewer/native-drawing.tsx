import { useId } from 'react';
import { PenLine } from 'lucide-react';

import { Button } from '@sunstead/ui/components/button';
import { NativeSurface } from '@/components/native-surface';
import { nativeSurfaces } from '@/lib/backend/native';
import { useSurfaceStates } from '@/lib/native-surfaces';
import { ViewerFrame } from './viewer-frame';

/**
 * A drawing in the iOS app: an infinite PaperKit canvas. The Pencil starts
 * drawing by itself; the button is for a finger, and to finish. Find looks
 * for the words written in it.
 */
export function NativeDrawing({ path }: { path: string }) {
  const id = useId();
  const editing = useSurfaceStates((s) => s[id]?.editing ?? false);
  const error = useSurfaceStates((s) => s[id]?.error);

  return (
    <ViewerFrame
      path={path}
      find
      leading={
        <Button
          variant={editing ? 'secondary' : 'ghost'}
          size='icon-sm'
          aria-pressed={editing}
          title={editing ? 'Done' : 'Draw'}
          onClick={() => void nativeSurfaces.edit(id, !editing)}
        >
          <PenLine />
          <span className='sr-only'>{editing ? 'Done' : 'Draw'}</span>
        </Button>
      }
    >
      {error && (
        <div className='absolute inset-x-0 top-0 z-10 bg-destructive/90 px-3 py-1.5 text-sm text-white'>
          {error}
        </div>
      )}
      <NativeSurface id={id} kind='drawing' path={path} />
    </ViewerFrame>
  );
}
