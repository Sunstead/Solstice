import { BookmarksView } from '@/components/bookmarks/bookmarks-view';
import { useWorkspace } from '@/hooks/use-workspace';
import { PhoneHeader, PhoneTitle } from './phone-parts';

/** Bookmarks as a page: the sidebar's Bookmarks view. */
export function BookmarksPage() {
  const root = useWorkspace((s) => s.path);

  return (
    <div className='absolute inset-0 flex flex-col bg-background'>
      <PhoneHeader large>
        <PhoneTitle>Bookmarks</PhoneTitle>
      </PhoneHeader>
      {root ? (
        <div className='flex min-h-0 flex-1 flex-col pt-2'>
          <BookmarksView key={root} root={root} />
        </div>
      ) : (
        <p className='py-10 text-center text-sm text-muted-foreground'>No workspace open</p>
      )}
    </div>
  );
}
