import type { TabNode } from 'flexlayout-react';
import { Ellipsis } from 'lucide-react';

import { Button } from '@sunstead/ui/components/button';
import { SyncIndicator } from '@/components/sync/status';
import { ShareButton } from '@/components/share-button';
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
 * name, share and ⋯. Sync shows only when it has something to say.
 */
export function NoteHeader({ shown }: { shown: TabNode | null }) {
  const showExtensions = useSetting('explorer.showFileExtensions');
  const goHome = usePhoneNav((s) => s.goHome);
  const page = usePhoneNav((s) => s.page);
  const path = tabPath(shown);
  // The ⋯ is the hold sheet, with what only an open note has on top.
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
            {path && <ShareButton path={path} className='phone-tint' />}
            <Button variant='ghost' size='icon' className='phone-tint' onClick={openActions}>
              <Ellipsis />
              <span className='sr-only'>More</span>
            </Button>
          </>
        }
    />
  );
}
