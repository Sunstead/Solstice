import { useId } from 'react';

import { InkRibbon } from '@/components/ink/ink-ribbon';
import { RibbonToggle } from '@/components/ink/ribbon-toggle';
import { ToolBadge } from '@/components/ink/tool-badge';
import { NativeSurface } from '@/components/native-surface';
import { useSurfaceStates } from '@/lib/native-surfaces';
import { useSetting } from '@/lib/settings/store';
import { ViewerFrame } from './viewer-frame';

/**
 * A PDF in the iOS app: PDFKit, marked up with PaperKit and Solstice's own
 * ink tools, pinned under the header (`InkRibbon`). The Pencil draws from
 * its first touch.
 */
export function NativePdf({ path }: { path: string }) {
  const id = useId();
  const ribbon = useSetting('ink.ribbon');
  const error = useSurfaceStates((s) => s[id]?.error);

  return (
    <ViewerFrame
      path={path}
      find
      leading={<RibbonToggle />}
      ribbon={ribbon && <InkRibbon surface='pdf' />}
    >
      {error && (
        <div className='absolute inset-x-0 top-0 z-10 bg-destructive/90 px-3 py-1.5 text-sm text-white'>
          {error}
        </div>
      )}
      <NativeSurface id={id} kind='pdf' path={path} />
      {!ribbon && <ToolBadge />}
    </ViewerFrame>
  );
}
