import { createElement, useState, type ComponentType } from 'react';
import { ArrowLeft, ArrowRight, Ban, Bookmark, Pipette } from 'lucide-react';

import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { FolderGlyph } from '@/components/folder-glyph';
import { getFileIconFor } from '@/assets/icons';
import { useWorkspace } from '@/hooks/use-workspace';
import type { EntryTarget } from '@/lib/entry-actions';
import { useEntryMenuItems, type EntryMenuItem } from '@/lib/entry-menu-items';
import { useIsMobile } from '@sunstead/ui/hooks/use-mobile';
import { can } from '@/lib/backend/platform';
import { getFileNameFromPath, getRelativePath, normalizePath, parentPath } from '@/lib/path-utils';
import { useSetting } from '@/lib/settings/store';
import { stripPresetExtension } from '@/lib/stores/entry-input';
import { useEntrySheet, type EntrySheetFrom } from '@/lib/stores/entry-sheet';
import { usePhoneNav } from '@/lib/stores/phone-nav';
import { useTreeMeta } from '@/lib/stores/tree-meta';
import { useFileIndex } from '@/lib/stores/use-file-index';
import { cn } from '@/lib/utils';
import { stepHistory } from './phone-history';
import { Row, RowGroup } from './phone-parts';

type Item = Extract<EntryMenuItem, { kind: 'item' }>;
type Submenu = Extract<EntryMenuItem, { kind: 'submenu' }>;

/** What a touch screen has no use for: other apps, paths; and on an iPhone, tabs. */
const LEFT_OUT = new Set([
  ...(can.tabs ? [] : ['open-new-tab', 'open-to-side']),
  'reveal-in-system',
  'open-in-default-app',
  'save-copy',
  'export-pdf',
  'copy-path',
  'new-file',
]);

/** The three done most, as round buttons under the header. */
const QUICK = ['bookmark', 'share', 'rename'];

/** Shorter names for a sheet, where there's no menu to tell them apart in. */
const PHONE_LABELS: Record<string, string> = {
  'copy-wikilink': 'Copy Link',
  'reveal-in-explorer': 'Show in Files',
};

/**
 * A file or folder's actions on a phone, from a hold on it (or a note's ⋯):
 * a bottom sheet headed by the item, a row of quick actions, then grouped
 * rows, Delete alone at the bottom, as Discord's channel sheet. Its items
 * are the entry menu's (`useEntryMenuItems`), so it never offers other
 * things than the menus do elsewhere; this only picks and arranges them.
 * Mounted once, at the root: the iPad's file menus are sheets too.
 */
export function EntrySheet() {
  const shown = useEntrySheet((s) => s.shown);
  const entry = useEntrySheet((s) => s.entry);
  const from = useEntrySheet((s) => s.from);
  const close = useEntrySheet((s) => s.close);

  return (
    <Sheet open={shown} onOpenChange={(open) => !open && close()}>
      <SheetContent
        side='bottom'
        showCloseButton={false}
        finalFocus={false}
        className='max-h-[85dvh] gap-0 rounded-t-2xl bg-sidebar pb-[env(safe-area-inset-bottom)]'
      >
        {entry ? (
          <EntryActions key={entry.path + from} entry={entry} from={from} onDone={close} />
        ) : (
          <NoteHistory onDone={close} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function EntryActions({ entry, from, onDone }: { entry: EntryTarget; from: EntrySheetFrom; onDone: () => void }) {
  const items = useEntryMenuItems(entry, {
    surface: from === 'note' ? 'editor' : 'tree',
    nameInDialog: true,
  });
  const [sharing, setSharing] = useState(false);
  // Back and Forward are the phone's own history of notes.
  const phone = useIsMobile();

  const run = (item: Item) => () => {
    onDone();
    item.run();
  };

  // The menu's separators become the gaps between groups.
  const groups: EntryMenuItem[][] = [[]];
  const quick = new Map<string, Item | Submenu>();
  let color: Submenu | null = null;
  let remove: Item | null = null;
  for (const item of items) {
    if (item.kind === 'separator') groups.push([]);
    else if (LEFT_OUT.has(item.id) || (from === 'tree' && item.id === 'reveal-in-explorer')) continue;
    else if (QUICK.includes(item.id)) quick.set(item.id, item);
    else if (item.id === 'folder-color' && item.kind === 'submenu') color = item;
    else if (item.id === 'delete' && item.kind === 'item') remove = item;
    else groups[groups.length - 1].push(item);
  }
  const share = quick.get('share');

  return (
    <div className='flex min-h-0 flex-col'>
      <EntryHeader entry={entry} />
      <div className='flex min-h-0 flex-col gap-4 overflow-y-auto px-4 pt-1 pb-4'>
        {from === 'note' && phone && <HistoryButtons path={entry.path} onDone={onDone} />}
        {quick.size > 0 && (
          <div className='flex gap-2'>
            {QUICK.map((id) => {
              const item = quick.get(id);
              if (!item) return null;
              const label = item.label.replace(/\.\.\.$|…$/, '');
              // Bookmarked shows filled, as a toggle, rather than as "Remove".
              const marked = id === 'bookmark' && label !== 'Bookmark';
              return (
                <QuickAction
                  key={id}
                  icon={id === 'bookmark' ? Bookmark : item.icon}
                  label={marked ? 'Bookmarked' : label}
                  active={marked}
                  pressed={id === 'share' && sharing}
                  disabled={item.kind === 'item' && item.disabled}
                  onClick={item.kind === 'submenu' ? () => setSharing((s) => !s) : run(item)}
                />
              );
            })}
          </div>
        )}
        {sharing && share?.kind === 'submenu' && (
          <RowGroup tone='sheet'>
            {share.items.map((sub) => sub.kind === 'item' && <ItemRow key={sub.id} item={sub} onClick={run(sub)} />)}
          </RowGroup>
        )}
        {groups
          .map((group) => group.filter((item): item is Item | Submenu => item.kind !== 'separator'))
          .filter((group) => group.length > 0)
          .map((group) => (
            <RowGroup key={group[0].id} tone='sheet'>
              {group.flatMap((item) =>
                item.kind === 'item'
                  ? [<ItemRow key={item.id} item={item} onClick={run(item)} />]
                  : // A submenu's items are rows of their own, named for it.
                    item.items.map(
                      (sub) =>
                        sub.kind === 'item' && (
                          <ItemRow key={sub.id} item={{ ...sub, label: `${item.label} (${sub.label})` }} onClick={run(sub)} />
                        ),
                    ),
              )}
            </RowGroup>
          ))}
        {color && <ColorChoices menu={color} onDone={onDone} />}
        {remove && (
          <RowGroup tone='sheet'>
            <ItemRow item={remove} onClick={run(remove)} />
          </RowGroup>
        )}
      </div>
    </div>
  );
}

/** The item itself: its icon (a folder in its colour), its name, and where it is. */
function EntryHeader({ entry }: { entry: EntryTarget }) {
  const root = useWorkspace((s) => s.path);
  const showExtensions = useSetting('explorer.showFileExtensions');
  const color = useTreeMeta((s) => (entry.is_dir ? s.folderColor(entry.path) : null));
  const count = useFileIndex((s) =>
    entry.is_dir ? s.files.filter((f) => parentPath(f.path) === normalizePath(entry.path)).length : 0,
  );
  const name = entry.name || getFileNameFromPath(entry.path);
  const shownName = entry.is_dir || showExtensions ? name : stripPresetExtension(name).name;
  const folder = root ? getRelativePath(parentPath(entry.path), root) || getFileNameFromPath(root) : '';
  const detail = entry.is_dir ? [folder, `${count} ${count === 1 ? 'item' : 'items'}`].filter(Boolean).join(' · ') : folder;

  return (
    <div className='flex items-center gap-3 px-5 pt-5 pb-3'>
      {entry.is_dir ? (
        <FolderGlyph color={color} className='size-10 shrink-0' />
      ) : (
        createElement(getFileIconFor(name), { className: 'size-10 shrink-0' })
      )}
      <div className='flex min-w-0 flex-col'>
        <SheetTitle className='truncate text-[17px] font-semibold'>{shownName}</SheetTitle>
        <SheetDescription className='truncate text-[13px] text-muted-foreground'>{detail}</SheetDescription>
      </div>
    </div>
  );
}

function QuickAction({
  icon: Icon,
  label,
  active = false,
  pressed = false,
  disabled = false,
  onClick,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  active?: boolean;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type='button'
      disabled={disabled}
      aria-pressed={pressed || undefined}
      onClick={onClick}
      className={cn(
        'flex min-w-0 flex-1 flex-col items-center gap-1.5 rounded-xl bg-muted py-3 text-[13px] outline-none active:opacity-60 disabled:opacity-40',
        pressed && 'bg-accent',
      )}
    >
      <Icon className={cn('size-5', active && 'fill-current text-primary')} />
      <span className='max-w-full truncate px-1'>{label}</span>
    </button>
  );
}

function ItemRow({ item, onClick }: { item: Item; onClick: () => void }) {
  return (
    <Row
      icon={item.icon}
      // "Move to..." reads "Move to", "Share (As PDF...)" "Share (As PDF)".
      label={PHONE_LABELS[item.id] ?? item.label.replace(/(\.\.\.|…)(?=\)?$)/, '')}
      destructive={item.destructive}
      disabled={item.disabled}
      onClick={onClick}
    />
  );
}

/** A folder's colours as swatches in a row, then Custom and None. */
function ColorChoices({ menu, onDone }: { menu: Submenu; onDone: () => void }) {
  const choices = menu.items.filter((item): item is Item => item.kind === 'item');
  return (
    <section className='flex flex-col gap-1.5'>
      <h2 className='px-3 text-[13px] text-muted-foreground'>{menu.label}</h2>
      <div className='flex flex-wrap items-center gap-3 rounded-xl bg-muted px-3 py-3'>
        {choices.map((item) => {
          const custom = item.id === 'folder-color-custom';
          const none = item.id === 'folder-color-none';
          return (
            <button
              key={item.id}
              type='button'
              aria-label={item.label.replace(/\.\.\.$/, '')}
              aria-pressed={item.checked || undefined}
              disabled={item.disabled}
              onClick={() => {
                onDone();
                item.run();
              }}
              className={cn(
                'flex size-8 items-center justify-center rounded-full ring-offset-2 ring-offset-muted active:opacity-60 disabled:opacity-40',
                item.checked && 'ring-2 ring-foreground',
                (custom || none) && 'bg-background',
              )}
            >
              {custom ? (
                <Pipette className='size-4' />
              ) : none ? (
                <Ban className='size-4' />
              ) : (
                createElement(item.icon, { className: 'size-8' })
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** Back and Forward through the notes shown here, at the top of a note's ⋯. */
function HistoryButtons({ path, onDone }: { path: string | null; onDone: () => void }) {
  const canBack = usePhoneNav((s) => s.back.length > 0);
  const canForward = usePhoneNav((s) => s.forward.length > 0);
  const step = (direction: 'back' | 'forward') => () => {
    onDone();
    stepHistory(direction, path);
  };
  return (
    <div className='flex gap-2'>
      <QuickAction icon={ArrowLeft} label='Back' disabled={!canBack} onClick={step('back')} />
      <QuickAction icon={ArrowRight} label='Forward' disabled={!canForward} onClick={step('forward')} />
    </div>
  );
}

/** A note's ⋯ with no file in it (a blank page): only the history. */
function NoteHistory({ onDone }: { onDone: () => void }) {
  return (
    <div className='flex flex-col gap-3 px-4 pt-5 pb-4'>
      <SheetTitle className='px-1 text-[17px] font-semibold'>Notes</SheetTitle>
      <SheetDescription className='sr-only'>Back and forward through notes</SheetDescription>
      <HistoryButtons path={null} onDone={onDone} />
    </div>
  );
}
