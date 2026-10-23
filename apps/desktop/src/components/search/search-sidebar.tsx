import { SidebarHeader } from '@sunstead/ui/components/resizable-sidebar';
import { useWorkspace } from '@/hooks/use-workspace';
import { SearchView } from './search-view';

/** The sidebar's Search view, beside the Explorer on the rail. */
export function SearchSidebar() {
  const path = useWorkspace((s) => s.path);
  const loading = useWorkspace((s) => s.loading);
  if (loading) return null;

  return (
    <>
      <SidebarHeader className='px-4 py-2 text-xs font-medium text-muted-foreground'>
        {/* As tall as the Explorer's, whose header has a button. */}
        <p className='flex h-8 touch:h-10 items-center'>Search</p>
      </SidebarHeader>
      {path ? (
        <SearchView root={path} />
      ) : (
        <p className='px-4 text-sm text-muted-foreground'>No workspace open</p>
      )}
    </>
  );
}
