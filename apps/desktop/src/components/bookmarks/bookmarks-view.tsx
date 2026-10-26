import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';

import type { FileEntry } from '@/bindings';
import { Button } from '@sunstead/ui/components/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@sunstead/ui/components/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@sunstead/ui/components/dropdown-menu';
import { EntryMenuItems } from '@/components/entry-menu-items';
import { EntryMenuTrigger } from '@/components/entry-menu-trigger';
import { useIsMobile } from '@sunstead/ui/hooks/use-mobile';
import { useCreateActions } from '@/hooks/use-create-actions';
import { useFileTreeDrag, useFileTreeDrop } from '@/hooks/use-file-tree-dnd';
import { useLayout } from '@/hooks/use-layout';
import { touchFirst } from '@/lib/backend/platform';
import { useEntryMenuItems } from '@/lib/entry-menu-items';
import { createSlotGesture } from '@/lib/ink/slot-gesture';
import { getFileNameFromPath, getRelativePath, normalizePath, parentPath } from '@/lib/path-utils';
import { useSetting } from '@/lib/settings/store';
import { useTreeMeta } from '@/lib/stores/tree-meta';
import { useEntrySheet } from '@/lib/stores/entry-sheet';
import { useFileIndex } from '@/lib/stores/use-file-index';
import { toAbs } from '@/lib/tree-meta/ops';
import { childrenOf, moveOp, visibleBookmarks } from '@/lib/tree-meta/view';
import { cn } from '@/lib/utils';
import { BookmarkCard } from './bookmark-card';
import { MenuAnchor } from './menu-anchor';

const contextComponents = {
  Item: ContextMenuItem,
  Separator: ContextMenuSeparator,
  Sub: ContextMenuSub,
  SubTrigger: ContextMenuSubTrigger,
  SubContent: ContextMenuSubContent,
};

const dropdownComponents = {
  Item: DropdownMenuItem,
  Separator: DropdownMenuSeparator,
  Sub: DropdownMenuSub,
  SubTrigger: DropdownMenuSubTrigger,
  SubContent: DropdownMenuSubContent,
};

/**
 * The workspace's bookmarks as large shortcuts: a file opens, a folder opens
 * here, notebook-style, its contents as the same cards, with a trail back.
 * Bookmarks reorder by dragging; inside a folder, files drag onto its
 * folders to move there. The sidebar's Bookmarks view and the phone's page.
 */
export function BookmarksView({
  root,
  header,
  onOpenFolder,
}: {
  root: string;
  header?: (trail: ReactNode) => ReactNode;
  /** Opens a folder somewhere else (a phone pushes it as a page) rather than here. */
  onOpenFolder?: (path: string) => void;
}) {
  const index = useFileIndex((s) => s.files);
  const indexed = useFileIndex((s) => s.lastLoadedAt !== null);
  const byPath = useMemo(() => new Map(index.map((e) => [normalizePath(e.path), e])), [index]);
  // Folders opened from a bookmark, outermost first.
  const [trail, setTrail] = useState<string[]>([]);
  // A folder deleted or renamed meanwhile goes back to the nearest one left.
  const missing = indexed ? trail.findIndex((p) => !byPath.has(normalizePath(p))) : -1;
  const openTrail = missing === -1 ? trail : trail.slice(0, missing);
  const folder = openTrail[openTrail.length - 1] ?? null;

  const crumbs = (
    <BookmarkTrail root={root} trail={openTrail} onBack={(depth) => setTrail(openTrail.slice(0, depth))} />
  );

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      {header?.(crumbs) ?? crumbs}
      <div className='flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-4'>
        {folder ? (
          <FolderContents
            folder={folder}
            index={index}
            onOpenFolder={(path) => setTrail([...openTrail, path])}
          />
        ) : (
          <TopBookmarks
            root={root}
            entryAt={(rel) => byPath.get(normalizePath(toAbs(root, rel)))}
            indexed={indexed}
            onOpenFolder={onOpenFolder ?? ((path) => setTrail([path]))}
          />
        )}
      </div>
    </div>
  );
}

/** One opened folder's contents on their own, for a page of its own (`BookmarksPage`). */
export function BookmarkFolder({ folder, onOpenFolder }: { folder: string; onOpenFolder: (path: string) => void }) {
  const index = useFileIndex((s) => s.files);
  return (
    <div className='flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pt-2 pb-4'>
      <FolderContents folder={folder} index={index} onOpenFolder={onOpenFolder} />
    </div>
  );
}

/** Back, the folders opened, and New in the one shown. */
function BookmarkTrail({ root, trail, onBack }: { root: string; trail: string[]; onBack: (depth: number) => void }) {
  const folder = trail[trail.length - 1] ?? null;
  const create = useCreateActions(folder, { dialog: true });
  if (!folder) return null;
  return (
    <div className='flex min-h-10 items-center gap-1 px-2 pb-2 text-sm'>
      <Button
        variant='ghost'
        size='icon-sm'
        title={trail.length > 1 ? 'Back' : 'Back to Bookmarks'}
        onClick={() => onBack(trail.length - 1)}
      >
        <ChevronLeft />
      </Button>
      <nav className='flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden' aria-label='Folders'>
        {trail.map((path, i) => (
          // The folder shown keeps its name; those before it give way first.
          <span key={path} className={cn('flex min-w-0 items-center gap-0.5', i < trail.length - 1 && 'shrink-[4]')}>
            {i > 0 && <ChevronRight className='size-3.5 shrink-0 text-muted-foreground' />}
            <button
              type='button'
              title={getRelativePath(path, root)}
              className={cn(
                'truncate rounded px-1',
                i === trail.length - 1 ? 'font-medium' : 'text-muted-foreground hover:text-foreground',
              )}
              onClick={() => onBack(i + 1)}
            >
              {getFileNameFromPath(path)}
            </button>
          </span>
        ))}
      </nav>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant='ghost' size='icon-sm' title='New in this folder'>
              <Plus />
            </Button>
          }
        />
        <DropdownMenuContent finalFocus={false}>
          {create.map((action) => (
            <DropdownMenuItem key={action.id} onClick={action.run}>
              <action.icon />
              {action.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

const open = (entry: FileEntry, onOpenFolder: (path: string) => void) =>
  entry.is_dir ? onOpenFolder(entry.path) : useLayout.getState().openFile(entry.path, entry.name);

/** Two columns, or one where they won't fit. */
function CardGrid({ children, ...props }: React.ComponentProps<'div'>) {
  return (
    <div className='@container'>
      <div className='grid grid-cols-1 gap-2 @min-[180px]:grid-cols-2' {...props}>
        {children}
      </div>
    </div>
  );
}

/** The bookmarks themselves, in order, dragged to reorder. */
function TopBookmarks({
  root,
  entryAt,
  indexed,
  onOpenFolder,
}: {
  root: string;
  entryAt: (rel: string) => FileEntry | undefined;
  indexed: boolean;
  onOpenFolder: (path: string) => void;
}) {
  const bookmarks = useTreeMeta((s) => s.meta.bookmarks);
  // Until the workspace is listed, nothing is known to be missing.
  const visible = useMemo(
    () => visibleBookmarks(bookmarks, (rel) => !indexed || entryAt(rel) !== undefined),
    [bookmarks, indexed, entryAt],
  );
  const shown = visible.map((b) => ({
    bookmark: b,
    entry: entryAt(b.path) ?? { path: toAbs(root, b.path), name: getFileNameFromPath(b.path), is_dir: false },
  }));
  const grid = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ entry: FileEntry; at: DOMRect } | null>(null);
  // What the gesture, set up once, acts on.
  const phone = useIsMobile();
  const latest = useRef({ visible, shown, phone });
  useLayoutEffect(() => {
    latest.current = { visible, shown, phone };
  });

  useEffect(() => {
    const el = grid.current;
    if (!el) return;
    return createSlotGesture(el, {
      flow: true,
      mouseDrag: true,
      move: (from, to) => {
        const op = moveOp(latest.current.visible, from, to);
        if (op) void useTreeMeta.getState().apply([op]);
      },
      menu: (i, at) => {
        const entry = latest.current.shown[i]?.entry;
        if (!entry) return;
        // A touch screen's is the hold sheet (`EntrySheet`).
        if (latest.current.phone || touchFirst) useEntrySheet.getState().open(entry);
        else setMenu({ entry, at });
      },
    });
  }, []);

  return (
    <>
      {shown.length === 0 && (
        <p className='px-4 py-10 text-center text-sm text-muted-foreground'>
          Bookmark a file or folder from its menu to keep it here.
        </p>
      )}
      <CardGrid ref={grid}>
        {shown.map(({ bookmark, entry }, i) => (
          <TopCard key={bookmark.id} index={i} entry={entry} root={root} onOpen={() => open(entry, onOpenFolder)} />
        ))}
      </CardGrid>
      {menu && !phone && <AnchoredEntryMenu entry={menu.entry} at={menu.at} onClose={() => setMenu(null)} />}
    </>
  );
}

const parentLabel = (entry: FileEntry, root: string) => {
  const parent = getRelativePath(parentPath(entry.path), root);
  return parent || getFileNameFromPath(root);
};

function TopCard({ entry, index, root, onOpen }: { entry: FileEntry; index: number; root: string; onOpen: () => void }) {
  // A folder bookmark takes files dropped on it.
  const { drop, isOver, canDrop } = useFileTreeDrop(entry.is_dir ? entry.path : '');
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (entry.is_dir) drop(ref);
  }, [drop, entry.is_dir]);
  return (
    <BookmarkCard
      ref={ref}
      data-slot-index={index}
      entry={entry}
      detail={parentLabel(entry, root)}
      dropping={entry.is_dir && isOver && canDrop}
      onClick={onOpen}
    />
  );
}

/** A card's menu where the gesture asked for it (a hold, or a right click). */
function AnchoredEntryMenu({ entry, at, onClose }: { entry: FileEntry; at: DOMRect; onClose: () => void }) {
  const items = useEntryMenuItems(entry, { surface: 'tree', nameInDialog: true });
  return (
    <DropdownMenu open onOpenChange={(next) => !next && onClose()}>
      <DropdownMenuTrigger nativeButton={false} render={<MenuAnchor at={at} />} />
      <DropdownMenuContent className='min-w-52' finalFocus={touchFirst ? false : undefined}>
        <EntryMenuItems items={items} components={dropdownComponents} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** An opened folder: its entries as cards, folders taking what's dropped on them. */
function FolderContents({
  folder,
  index,
  onOpenFolder,
}: {
  folder: string;
  index: FileEntry[];
  onOpenFolder: (path: string) => void;
}) {
  const showHidden = useSetting('explorer.showHiddenFiles');
  const foldersFirst = useSetting('explorer.foldersFirst');
  const entries = useMemo(
    () => childrenOf(index, folder, { showHidden, foldersFirst }),
    [index, folder, showHidden, foldersFirst],
  );
  const { drop } = useFileTreeDrop(folder);
  const phone = useIsMobile();
  const area = useRef<HTMLDivElement>(null);
  useEffect(() => {
    drop(area);
  }, [drop]);

  // Its own empty space is the folder: a right click there is its menu, as
  // the Explorer's empty space is the workspace's.
  const self: FileEntry = { path: folder, name: getFileNameFromPath(folder), is_dir: true };

  const contents = (
    <div ref={area} className='grow'>
      {entries.length === 0 ? (
        <p className='px-4 py-10 text-center text-sm text-muted-foreground'>This folder is empty.</p>
      ) : (
        <CardGrid>
          {entries.map((entry) => (
            <FolderEntryCard key={entry.path} entry={entry} onOpen={() => open(entry, onOpenFolder)} />
          ))}
        </CardGrid>
      )}
    </div>
  );
  // A phone's holds are the cards' sheets; a menu here would open with each.
  if (phone) return contents;

  return (
    <ContextMenu>
      <ContextMenuTrigger render={contents} />
      <FolderEntryMenu entry={self} />
    </ContextMenu>
  );
}

function FolderEntryCard({ entry, onOpen }: { entry: FileEntry; onOpen: () => void }) {
  const { drag, isDragging } = useFileTreeDrag(entry);
  const { drop, isOver, canDrop } = useFileTreeDrop(entry.is_dir ? entry.path : parentPath(entry.path));
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    drag(ref);
    if (entry.is_dir) drop(ref);
  }, [drag, drop, entry.is_dir]);
  const children = useFileIndex((s) => (entry.is_dir ? s.files.filter((f) => parentPath(f.path) === normalizePath(entry.path)).length : 0));
  const detail = entry.is_dir ? `${children} ${children === 1 ? 'item' : 'items'}` : fileKind(entry.name);

  return (
    <EntryMenuTrigger
      entry={entry}
      render={
        <BookmarkCard
          ref={ref}
          entry={entry}
          detail={detail}
          dropping={entry.is_dir && isOver && canDrop}
          className={cn(isDragging && 'opacity-50')}
          onClick={onOpen}
        />
      }
      menu={<FolderEntryMenu entry={entry} />}
    />
  );
}

function FolderEntryMenu({ entry }: { entry: FileEntry }) {
  const items = useEntryMenuItems(entry, { surface: 'tree', nameInDialog: true });
  return (
    <ContextMenuContent className='min-w-52' finalFocus={touchFirst ? false : undefined}>
      <EntryMenuItems items={items} components={contextComponents} />
    </ContextMenuContent>
  );
}

/** What kind of file it is, from its extension: `PDF`, `Markdown`... */
function fileKind(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.task.md')) return 'Task board';
  if (lower.endsWith('.drawing.svg')) return 'Drawing';
  const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : '';
  const kinds: Record<string, string> = { md: 'Note', pdf: 'PDF', canvas: 'Canvas' };
  return kinds[ext] ?? (ext ? ext.toUpperCase() : 'File');
}
