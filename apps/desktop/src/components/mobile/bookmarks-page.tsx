import { createRef, useMemo, useRef, useState } from 'react';
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
  // Folders pushed, deepest last, and how many are open: those past it are
  // sliding away. Each is a pane of its own over the one before, so
  // swiping one back leaves the rest as they were.
  const [trail, setTrail] = useState<string[]>([]);
  const [depth, setDepth] = useState(0);
  const page = useRef<HTMLDivElement>(null);
  const levels = useMemo(() => Array.from({ length: MAX_DEPTH }, () => createRef<HTMLDivElement>()), []);

  // A folder deleted or renamed meanwhile goes back to the nearest one left.
  const missing = useFileIndex((s) => {
    if (s.lastLoadedAt === null) return -1;
    const paths = new Set(s.files.map((f) => normalizePath(f.path)));
    return trail.slice(0, depth).findIndex((p) => !paths.has(normalizePath(p)));
  });
  const openCount = missing === -1 ? depth : missing;

  const push = (path: string) => {
    if (openCount >= MAX_DEPTH) return;
    setTrail([...trail.slice(0, openCount), path]);
    setDepth(openCount + 1);
  };
  /** Level `level` leaves, and everything over it. */
  const popTo = (level: number) => setDepth((d) => Math.min(d, level));

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
      {trail.map((folder, i) => (
        <PushPane
          key={`${i}:${folder}`}
          open={i < openCount}
          appear
          onClose={() => popTo(i)}
          behind={i === 0 ? page : levels[i - 1]}
        >
          <div ref={levels[i]} className='flex h-full min-h-0 flex-col'>
            <FolderPage
              folder={folder}
              back={i > 0 ? getFileNameFromPath(trail[i - 1]) : 'Bookmarks'}
              onBack={() => popTo(i)}
              onOpenFolder={push}
            />
          </div>
        </PushPane>
      ))}
    </div>
  );
}

/** How deep folders are pushed; past it, opening another does nothing. */
const MAX_DEPTH = 24;

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
