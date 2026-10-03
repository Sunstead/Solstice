import FileBreadcrumb from '@/components/file-breadcrumb';
import { FileActionsDropdown } from '@/components/file-actions-dropdown';
import { FindBar } from '@/components/find-bar';
import { revealInExplorer } from '@/lib/entry-actions';
import { useFindStore } from '@/lib/stores/find';
import { cn } from '@/lib/utils';

type ViewerHeaderProps = {
  path: string;
  /**
   * Sticky inside a scrolling parent (markdown, whose header scrolls with the
   * document) rather than a plain row above one (the viewers, which scroll
   * their own content instead).
   */
  sticky?: boolean;
  /**
   * Whether this file type has a find engine behind it. Gates both the find
   * bar and the "Find..." menu item, so a viewer that cannot search never
   * offers a bar that would report zero matches forever.
   */
  find?: boolean;
  /** Rendered in the left grid cell, which is otherwise empty. */
  leading?: React.ReactNode;
};

/**
 * The one header every open file gets: path breadcrumb in the middle, file
 * actions on the right.
 *
 * Lifted out of `FileEditor` so image, PDF and media tabs are not second-class
 * -- they used to open with no path context and no way to reach the file
 * actions at all.
 */
export function ViewerHeader({
  path,
  sticky = false,
  find = false,
  leading,
}: ViewerHeaderProps) {
  const findOpen = useFindStore((s) => s.openPath === path);

  return (
    <div
      className={cn(
        'grid grid-cols-[max-content_1fr_max-content] items-center justify-items-center bg-background p-2 pr-4 z-10',
        // Both are `position` values, so they cannot be combined. Sticky is
        // itself a positioned ancestor, which is what the overlay below needs.
        sticky ? 'sticky top-0' : 'relative',
      )}
    >
      <div className='flex items-center'>{leading}</div>
      <div className='flex items-center justify-center min-w-0 w-full justify-self-stretch'>
        <FileBreadcrumb
          filePath={path}
          className='min-w-0 max-w-full'
          onNavigate={(folder) => void revealInExplorer(folder)}
        />
      </div>
      <div className='flex items-center'>
        <FileActionsDropdown path={path} surface={find ? 'editor' : 'viewer'} />
      </div>

      {/*
        Anchored to the header rather than to the scrolling content: the
        header is the one box in here that never moves. A panel positioned
        against the document would slide up under it the moment the user
        scrolled. `top-full` then hangs it just below the header, clear of
        the actions button it would otherwise cover.
      */}
      {find && findOpen && (
        <div className='absolute top-full right-3 z-20 mt-1'>
          <FindBar onClose={() => useFindStore.getState().close()} />
        </div>
      )}
    </div>
  );
}
