import { forwardRef, type ComponentProps } from 'react';

import type { FileEntry } from '@/bindings';
import { getFileIconFor } from '@/assets/icons';
import { FolderGlyph } from '@/components/folder-glyph';
import { useSetting } from '@/lib/settings/store';
import { stripPresetExtension } from '@/lib/stores/entry-input';
import { useTreeMeta } from '@/lib/stores/tree-meta';
import { cn } from '@/lib/utils';

/**
 * A large shortcut to a file or folder: a card in the Bookmarks view's two
 * columns, a row once the panel is too narrow for them (the `@container`
 * around the list, `BookmarkList`).
 */
export const BookmarkCard = forwardRef<
  HTMLButtonElement,
  { entry: FileEntry; detail: string; dropping?: boolean } & ComponentProps<'button'>
>(function BookmarkCard({ entry, detail, dropping, className, ...props }, ref) {
  const showExtensions = useSetting('explorer.showFileExtensions');
  const color = useTreeMeta((s) => (entry.is_dir ? s.folderColor(entry.path) : null));
  const Icon = getFileIconFor(entry.name);
  const name = entry.is_dir || showExtensions ? entry.name : stripPresetExtension(entry.name).name;

  return (
    <button
      ref={ref}
      type='button'
      title={entry.name}
      className={cn(
        'flex min-h-14 w-full min-w-0 items-center gap-3 rounded-lg border border-transparent bg-sidebar-accent/40 px-3 py-2 text-left',
        'transition-[background-color,scale,box-shadow] select-none [-webkit-touch-callout:none] hover:bg-sidebar-accent',
        '@min-[180px]:min-h-24 @min-[180px]:flex-col @min-[180px]:items-start @min-[180px]:justify-between @min-[180px]:gap-2',
        'data-lifted:z-10 data-lifted:scale-105 data-lifted:bg-sidebar-accent data-lifted:shadow-md',
        dropping && 'border-sidebar-ring bg-sidebar-accent',
        className,
      )}
      {...props}
    >
      {entry.is_dir ? (
        <FolderGlyph color={color} className='size-7 shrink-0' />
      ) : (
        <Icon className='size-7 shrink-0' />
      )}
      <span className='flex w-full min-w-0 flex-col'>
        <span className='truncate text-sm font-medium'>{name}</span>
        <span className='truncate text-xs text-muted-foreground'>{detail}</span>
      </span>
    </button>
  );
});
