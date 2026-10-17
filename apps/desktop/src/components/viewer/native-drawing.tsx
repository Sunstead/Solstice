import { useId } from 'react';
import { Hand } from 'lucide-react';

import { Button } from '@sunstead/ui/components/button';
import { NativeSurface } from '@/components/native-surface';
import { nativeSurfaces } from '@/lib/backend/native';
import { useSurfaceStates } from '@/lib/native-surfaces';
import { PaperToggle } from './paper-toggle';
import { ViewerFrame } from './viewer-frame';

/**
 * A drawing in the iOS app: an infinite PaperKit canvas. The Pencil draws
 * from its first touch; the button lets a finger draw too, on every PDF and
 * drawing. Find looks for the words written in it.
 */
export function NativeDrawing({ path }: { path: string }) {
  const id = useId();
  const fingerDraws = useSurfaceStates((s) => s[id]?.editing ?? false);
  const error = useSurfaceStates((s) => s[id]?.error);

  return (
    <ViewerFrame
      path={path}
      find
      leading={
        <>
          <Button
            variant={fingerDraws ? 'secondary' : 'ghost'}
            size='icon-sm'
            aria-pressed={fingerDraws}
            title='Draw with Finger'
            onClick={() => void nativeSurfaces.edit(id, !fingerDraws)}
          >
            <Hand />
            <span className='sr-only'>Draw with Finger</span>
          </Button>
          <PaperToggle />
        </>
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
