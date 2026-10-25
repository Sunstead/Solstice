import { useShallow } from 'zustand/react/shallow';

import { QuickOpenItem } from '@/components/quick-open-dialog';
import { SearchView } from '@/components/search/search-view';
import { useLayout } from '@/hooks/use-layout';
import { useWorkspace } from '@/hooks/use-workspace';
import { getFileNameFromPath } from '@/lib/path-utils';
import { useRecentFiles } from '@/lib/stores/recent-files';
import { useFileIndex } from '@/lib/stores/use-file-index';
import { PhoneHeader, PhoneTitle } from './phone-parts';

/**
 * Search as a page: the sidebar's Search view, with the files opened lately
 * before anything's typed. Quick open on a phone too, since files whose names
 * match come first.
 */
export function SearchPage() {
  const root = useWorkspace((s) => s.path);

  return (
    <div className='absolute inset-0 flex flex-col bg-background'>
      <PhoneHeader large>
        <PhoneTitle>Search</PhoneTitle>
      </PhoneHeader>
      {root ? (
        <div className='flex min-h-0 flex-1 flex-col pt-2'>
          <SearchView root={root} empty={<RecentFiles root={root} />} autoFocus />
        </div>
      ) : (
        <p className='py-10 text-center text-sm text-muted-foreground'>No workspace open</p>
      )}
    </div>
  );
}

function RecentFiles({ root }: { root: string }) {
  const known = new Set(useFileIndex(useShallow((s) => s.files.map((f) => f.path))));
  const recent = useRecentFiles((s) => s.paths).filter((p) => known.has(p));
  if (recent.length === 0) {
    return <p className='py-10 text-center text-sm text-muted-foreground'>Search notes, canvases, PDFs and handwriting.</p>;
  }
  return (
    <section>
      <p className='px-2 pt-1 pb-1 text-xs font-medium text-muted-foreground'>Recent</p>
      {recent.map((path) => (
        <button
          key={path}
          type='button'
          className='flex min-h-12 w-full items-center rounded-lg px-3 text-left hover:bg-accent'
          onClick={() => useLayout.getState().openFile(path, getFileNameFromPath(path))}
        >
          <QuickOpenItem entry={{ path, name: getFileNameFromPath(path) }} root={root} />
        </button>
      ))}
    </section>
  );
}
