import { useRef, useState } from 'react';
import { Plus } from 'lucide-react';

import { Button } from '@sunstead/ui/components/button';
import { BookmarkFolder, BookmarksView } from '@/components/bookmarks/bookmarks-view';
import { useWorkspace } from '@/hooks/use-workspace';
import { getFileNameFromPath, normalizePath } from '@/lib/path-utils';
import { useFileIndex } from '@/lib/stores/use-file-index';
import { NewSheet } from './files-page';
import { PhoneHeader, PhoneTitle, PushedHeader } from './phone-parts';
import { PullToSync } from './pull-to-sync';
import { PushPane } from './push-pane';

/**
 * Bookmarks as a page: the sidebar's Bookmarks view, with each folder opened
 * from it pushed as a page of its own (swiped back, named in the bar, the
 * one before it on Back), as Files' own drill-in on iOS.
 */
export function BookmarksPage() {
  const root = useWorkspace((s) => s.path);
  // Another workspace starts at its bookmarks.
  return <BookmarksStack key={root ?? ''} root={root} />;
}

function BookmarksStack({ root }: { root: string | null }) {
  // Folders pushed, deepest last; `shown` stays while the last slides away.
  const [stack, setStack] = useState<string[]>([]);
  const [shown, setShown] = useState<string | null>(null);
  const page = useRef<HTMLDivElement>(null);

  // A folder deleted or renamed meanwhile goes back to the nearest one left.
  const missing = useFileIndex((s) => {
    if (s.lastLoadedAt === null) return -1;
    const paths = new Set(s.files.map((f) => normalizePath(f.path)));
    return stack.findIndex((p) => !paths.has(normalizePath(p)));
  });
  const open = missing === -1 ? stack : stack.slice(0, missing);

  const push = (path: string) => {
    setStack([...open, path]);
    setShown(path);
  };
  const pop = () => {
    const rest = open.slice(0, -1);
    setStack(rest);
    if (rest.length) setShown(rest[rest.length - 1]);
  };

  const at = shown ? open.lastIndexOf(shown) : -1;
  const back = at > 0 ? getFileNameFromPath(open[at - 1]) : 'Bookmarks';

  return (
    <div data-phone-page='bookmarks' className='absolute inset-0 overflow-hidden bg-background'>
      <div ref={page} className='flex h-full flex-col'>
        <PhoneHeader large>
          <PhoneTitle>Bookmarks</PhoneTitle>
        </PhoneHeader>
        {root ? (
          <PullToSync className='flex min-h-0 flex-1 flex-col pt-2'>
            <BookmarksView root={root} onOpenFolder={push} />
          </PullToSync>
        ) : (
          <p className='py-10 text-center text-sm text-muted-foreground'>No workspace open</p>
        )}
      </div>
      <PushPane open={open.length > 0} onClose={pop} behind={page}>
        {shown && <FolderPage key={shown} folder={shown} back={back} onBack={pop} onOpenFolder={push} />}
      </PushPane>
    </div>
  );
}

function FolderPage({
  folder,
  back,
  onBack,
  onOpenFolder,
}: {
  folder: string;
  back: string;
  onBack: () => void;
  onOpenFolder: (path: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PushedHeader
        back={back}
        onBack={onBack}
        title={getFileNameFromPath(folder)}
        actions={
          <Button variant='ghost' size='icon' className='phone-tint' onClick={() => setCreating(true)}>
            <Plus />
            <span className='sr-only'>New in this folder</span>
          </Button>
        }
      />
      <BookmarkFolder folder={folder} onOpenFolder={onOpenFolder} />
      <NewSheet folder={folder} dialog open={creating} onOpenChange={setCreating} />
    </>
  );
}
