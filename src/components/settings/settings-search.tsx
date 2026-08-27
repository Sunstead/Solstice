import { Search, X } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useSettingsDialog } from '@/lib/stores/settings-dialog';

/**
 * The search field. Rendered twice -- once in the sidebar, once in the narrow
 * header where the sidebar is hidden -- both bound to the same store field, so
 * whichever one is on screen is the one that works.
 */
export function SettingsSearch({ className }: { className?: string }) {
  const query = useSettingsDialog((s) => s.query);
  const setQuery = useSettingsDialog((s) => s.setQuery);

  return (
    <div className={cn('relative', className)}>
      <Search className='pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground' />
      <Input
        type='search'
        value={query}
        placeholder='Search settings'
        aria-label='Search settings'
        className='h-8 pr-7 pl-8 text-sm [&::-webkit-search-cancel-button]:hidden'
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          // Clear before letting Escape reach the dialog, so the first press
          // undoes the search rather than closing everything.
          if (event.key === 'Escape' && query) {
            event.stopPropagation();
            setQuery('');
          }
        }}
      />
      {query && (
        <button
          type='button'
          aria-label='Clear search'
          onClick={() => setQuery('')}
          className='absolute top-1/2 right-1.5 -translate-y-1/2 rounded-sm p-1 text-muted-foreground hover:text-foreground'
        >
          <X className='size-3.5' />
        </button>
      )}
    </div>
  );
}
