import { FileWarning } from 'lucide-react';

import { useAssetUrl } from '@/lib/viewer/asset';
import { useSetting } from '@/lib/settings/store';
import { basename } from '@/lib/wikilink/target';
import { MediaPlayer } from './media-player';
import { ViewerFrame } from './viewer-frame';

/**
 * A media file opened as its own tab.
 *
 * The player owns its controls rather than using the frame's toolbar slot:
 * they have to auto-hide over playing video, and in fullscreen they must be
 * inside the element that went fullscreen.
 */
export function MediaViewer({ path, kind }: { path: string; kind: 'video' | 'audio' }) {
  const asset = useAssetUrl(path);
  const autoPlay = useSetting('viewer.mediaAutoplay');
  const name = basename(path);

  if (asset.status === 'error') {
    return (
      <ViewerFrame path={path}>
        <div className='flex h-full flex-col items-center justify-center gap-3 p-6 text-center'>
          <FileWarning className='size-8 text-muted-foreground' />
          <p className='text-sm text-muted-foreground'>
            Could not load {name}: {asset.message}
          </p>
        </div>
      </ViewerFrame>
    );
  }

  if (asset.status === 'loading') {
    return (
      <ViewerFrame path={path}>
        <div className='p-4 text-muted-foreground'>Loading…</div>
      </ViewerFrame>
    );
  }

  if (kind === 'video') {
    return (
      <ViewerFrame path={path}>
        <MediaPlayer
          src={asset.url}
          kind='video'
          autoPlay={autoPlay}
          className='absolute inset-0'
        />
      </ViewerFrame>
    );
  }

  return (
    <ViewerFrame path={path}>
      <div className='flex h-full items-center justify-center p-6'>
        <MediaPlayer
          src={asset.url}
          kind='audio'
          title={name}
          autoPlay={autoPlay}
          className='w-full max-w-xl'
        />
      </div>
    </ViewerFrame>
  );
}
