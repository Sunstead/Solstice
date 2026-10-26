import { useEffect, useId } from 'react';
import { LocateFixed } from 'lucide-react';

import { Button } from '@sunstead/ui/components/button';

import { InkRibbon } from '@/components/ink/ink-ribbon';
import { RibbonToggle } from '@/components/ink/ribbon-toggle';
import { ToolBadge } from '@/components/ink/tool-badge';
import { NativeSurface } from '@/components/native-surface';
import { nativeSurfaces } from '@/lib/backend/native';
import { showingDrawing } from '@/lib/drawing-views';
import { useSurfaceStates } from '@/lib/native-surfaces';
import { useSetting } from '@/lib/settings/store';
import { ViewerFrame } from './viewer-frame';

export function ResetViewButton({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    // The canvas is near endless and mostly blank: a way home from wherever a pan went.
    <Button variant='ghost' size='icon-sm' className={className} title='Reset View' onClick={onClick}>
      <LocateFixed />
      <span className='sr-only'>Reset View</span>
    </Button>
  );
}

/**
 * A drawing in the iOS app: an infinite PaperKit canvas. The Pencil draws
 * from its first touch, with the ink tools pinned under the header
 * (`InkRibbon`). Find looks for the words written in it.
 */
export function NativeDrawing({ path }: { path: string }) {
  const id = useId();
  const ribbon = useSetting('ink.ribbon');
  const error = useSurfaceStates((s) => s[id]?.error);

  useEffect(() => showingDrawing(path, id), [path, id]);

  return (
    <ViewerFrame
      path={path}
      find
      leading={
        <>
          <RibbonToggle />
          <ResetViewButton onClick={() => void nativeSurfaces.recentre(id)} />
        </>
      }
      ribbon={ribbon && <InkRibbon surface='drawing' />}
    >
      {error && (
        <div className='absolute inset-x-0 top-0 z-10 bg-destructive/90 px-3 py-1.5 text-sm text-white'>
          {error}
        </div>
      )}
      <NativeSurface id={id} kind='drawing' path={path} />
      {!ribbon && <ToolBadge />}
    </ViewerFrame>
  );
}
