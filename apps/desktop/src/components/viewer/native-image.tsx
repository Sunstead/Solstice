import { useId } from 'react';

import { InkRibbon } from '@/components/ink/ink-ribbon';
import { RibbonToggle } from '@/components/ink/ribbon-toggle';
import { ToolBadge } from '@/components/ink/tool-badge';
import { NativeSurface } from '@/components/native-surface';
import { useSurfaceStates } from '@/lib/native-surfaces';
import { useSetting } from '@/lib/settings/store';
import { ViewerFrame } from './viewer-frame';

/**
 * A PNG, JPEG or HEIC in the iOS app, marked up in place as Preview does
 * (`ImageSurface`): the Pencil draws on it from its first touch, with the
 * ink tools under the header, and the marks are saved into the image.
 */
export function NativeImage({ path }: { path: string }) {
  const id = useId();
  const ribbon = useSetting('ink.ribbon');
  const error = useSurfaceStates((s) => s[id]?.error);

  return (
    <ViewerFrame path={path} leading={<RibbonToggle />} ribbon={ribbon && <InkRibbon surface='image' />}>
      {error && (
        <div className='absolute inset-x-0 top-0 z-10 bg-destructive/90 px-3 py-1.5 text-sm text-white'>{error}</div>
      )}
      <NativeSurface id={id} kind='image' path={path} />
      {!ribbon && <ToolBadge />}
    </ViewerFrame>
  );
}
