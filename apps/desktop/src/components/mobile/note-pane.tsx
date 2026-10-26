import type { TabNode } from 'flexlayout-react';
import { Ellipsis } from 'lucide-react';

import { Button } from '@sunstead/ui/components/button';
import { SyncIndicator } from '@/components/sync/status';
import { RibbonToggle } from '@/components/ink/ribbon-toggle';
import { ResetViewButton } from '@/components/viewer/native-drawing';
import { recentreDrawing } from '@/lib/drawing-views';
import { can } from '@/lib/backend/platform';
import { embedKind, isDrawing } from '@/lib/embed/kind';
import { isMarkableImage } from '@/lib/ink/insert';
import { startRename, targetFromPath } from '@/lib/entry-actions';
import { primeKeyboard } from '@/lib/keyboard-primer';
import { useSetting } from '@/lib/settings/store';
import { useEntrySheet } from '@/lib/stores/entry-sheet';
import { usePhoneNav, type PhonePage } from '@/lib/stores/phone-nav';
import { tabPath } from './phone-history';
import { PushedHeader } from './phone-parts';
import { tabTitle } from './tabs';

const PAGE_NAMES: Record<PhonePage, string> = { files: 'Files', bookmarks: 'Bookmarks', search: 'Search', you: 'You' };

/**
 * The note's top bar, as Notes keeps it: back to the page it came from, its
 * name and ⋯ (Share is in it). Sync shows only when it has something to say.
 */
export function NoteHeader({ shown }: { shown: TabNode | null }) {
  const showExtensions = useSetting('explorer.showFileExtensions');
  const goHome = usePhoneNav((s) => s.goHome);
  const page = usePhoneNav((s) => s.page);
  const path = tabPath(shown);
  // The ⋯ is the hold sheet, with what only an open note has on top.
  // What file-view shows on a native surface, where the viewer's own header is hidden on a phone.
  const drawing = !!path && can.nativeViews && isDrawing(path);
  const markable =
    !!path && can.nativeViews && (drawing || embedKind(path) === 'pdf' || isMarkableImage(path));
  const openActions = () => useEntrySheet.getState().open(path ? targetFromPath(path) : null, 'note');

  return (
    <PushedHeader
        back={PAGE_NAMES[page]}
        onBack={goHome}
        title={
          path ? (
            // Tapping the name renames it, as Notes and Files do; the
            // keyboard comes up in the tap.
            <button
              type='button'
              className='max-w-full truncate active:opacity-40'
              onClick={() => {
                primeKeyboard();
                void startRename(path);
              }}
            >
              {shown ? tabTitle(shown, showExtensions) : ''}
            </button>
          ) : (
            ''
          )
        }
        actions={
          <>
            <SyncIndicator quiet />
            {drawing && <ResetViewButton className='phone-tint' onClick={() => recentreDrawing(path)} />}
            {markable && <RibbonToggle className='phone-tint' />}
            <Button variant='ghost' size='icon' className='phone-tint' data-share-anchor={path ?? undefined} onClick={openActions}>
              <Ellipsis />
              <span className='sr-only'>More</span>
            </Button>
          </>
        }
    />
  );
}
