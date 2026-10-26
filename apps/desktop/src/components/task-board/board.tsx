import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { Check, Copy, ListPlus, MoreHorizontal, PencilLine, Plus, Square, Trash2, Trash2Icon } from 'lucide-react';

import { CanvasColorPicker } from '@/components/canvas/canvas-color-picker';
import { resolveCanvasColor } from '@/lib/canvas/color';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@sunstead/ui/components/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@sunstead/ui/components/dropdown-menu';
import { useIsMobile } from '@sunstead/ui/hooks/use-mobile';
import { primeKeyboard } from '@/lib/keyboard-primer';
import { createBoardGesture, type BoardTarget } from '@/lib/task-board/board-gesture';
import {
  addCard,
  addColumn,
  addSubtask,
  deleteCard,
  deleteColumn,
  deleteSubtask,
  editCard,
  moveCard,
  moveColumn,
  renameColumn,
  setColumnColor,
  toggleCard,
  toggleSubtask,
} from '@/lib/task-board/edit';
import { cardAt, cardMarkdown, parseBoard, type CardRef } from '@/lib/task-board/parse';
import type { BoardStore } from '@/lib/task-board/store';
import { cn } from '@/lib/utils';
import { BoardCard, CardEditor } from './board-card';
import { haptics } from '@/lib/haptics';

type Editing = { kind: 'card'; ref: CardRef } | { kind: 'new-card'; column: number; key?: number } | null;
type Menu = { target: BoardTarget; x: number; y: number } | null;

/** The columns and cards of a board note, every change a `commit` of edited text. */
export function Board({ path, store }: { path: string; store: BoardStore }) {
  const text = useStore(store, (s) => s.text);
  const board = useMemo(() => parseBoard(text), [text]);
  const paged = useIsMobile();
  const rootRef = useRef<HTMLDivElement>(null);

  const [editing, setEditing] = useState<Editing>(null);
  const [renaming, setRenaming] = useState<number | 'new' | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [subtaskOf, setSubtaskOf] = useState<CardRef | null>(null);
  const [menu, setMenu] = useState<Menu>(null);
  // Kept while the menu animates out, so it doesn't jump to the corner.
  const [menuAt, setMenuAt] = useState<Menu>(null);
  if (menu && menu !== menuAt) setMenuAt(menu);

  /** Applies an edit to whatever the text is now: handlers outlive renders. */
  const change = (edit: (text: string) => string) => store.getState().commit(edit(store.getState().text));

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    return createBoardGesture(root, {
      moveCard: (from, to) => store.getState().commit(moveCard(store.getState().text, from, to)),
      moveColumn: (from, to) => store.getState().commit(moveColumn(store.getState().text, from, to)),
      menu: (target, at) => setMenu({ target, ...at }),
      paged,
    });
  }, [store, paged]);

  const startEditing = (next: Editing) => {
    primeKeyboard();
    setEditing(next);
  };
  const startSubtask = (ref: CardRef) => {
    primeKeyboard();
    setSubtaskOf(ref);
  };
  const startRenaming = (column: number | 'new') => {
    primeKeyboard();
    setRenaming(column);
  };

  /**
   * A menu item that opens a field waits for the menu to close: the focus it
   * hands back as it goes would blur the field at once. The keyboard is
   * raised now, in the tap.
   */
  const afterMenu = (run: () => void) => () => {
    primeKeyboard();
    setTimeout(run, 0);
  };

  const menuTarget = menuAt?.target;
  const menuCard = menuTarget?.kind === 'card' ? cardAt(board, menuTarget.ref) : null;

  /*
   * Undo bound here as well as through the command system, as the canvas
   * does: on macOS the Edit menu's Undo goes to the responder chain and never
   * emits a `MenuCommand`. Fields keep their own.
   */
  const onKeyDown = (event: React.KeyboardEvent) => {
    if ((event.target as Element).closest('input, textarea')) return;
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (mod && (key === 'z' || key === 'y')) {
      event.preventDefault();
      if (key === 'y' || event.shiftKey) store.getState().redo();
      else store.getState().undo();
    }
  };

  return (
    // Focusable, so a click anywhere on the board brings its keys here.
    <div className='absolute inset-0 flex flex-col outline-none' tabIndex={-1} onKeyDown={onKeyDown}>
      {board.title !== null && <h1 className='board-title'>{board.title}</h1>}

      <div ref={rootRef} className={cn('board', paged && 'is-paged')} data-board>
        {board.columns.map((column, c) => (
          <section
            key={`${c}:${column.name}`}
            className='board-column'
            data-column-index={c}
            data-tinted={column.color ? '' : undefined}
            style={{ '--column-color': resolveCanvasColor(column.color ?? undefined) ?? undefined } as React.CSSProperties}
          >
            <header className='board-column-header' data-column-handle>
              {renaming === c ? (
                <NameField
                  initial={column.name}
                  onSave={(name) => {
                    setRenaming(null);
                    change((t) => renameColumn(t, c, name));
                  }}
                  onCancel={() => setRenaming(null)}
                />
              ) : (
                <h2 className='board-column-name' onDoubleClick={() => startRenaming(c)}>
                  {column.name || 'Untitled'}
                </h2>
              )}
              <span className='board-column-count'>{column.cards.length}</span>
              <button
                type='button'
                className='board-icon-button'
                aria-label={`${column.name} options`}
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  setMenu({ target: { kind: 'column', column: c }, x: rect.left + rect.width / 2, y: rect.bottom });
                }}
              >
                <MoreHorizontal className='size-4' />
              </button>
            </header>

            <div className='board-cards' data-column-scroll>
              {column.cards.map((card, i) =>
                editing?.kind === 'card' && editing.ref.column === c && editing.ref.card === i ? (
                  <CardEditor
                    key={`${i}:edit`}
                    initial={cardMarkdown(card)}
                    onSave={(markdown) => {
                      setEditing(null);
                      change((t) => editCard(t, { column: c, card: i }, markdown));
                    }}
                    onCancel={() => setEditing(null)}
                  />
                ) : (
                  <BoardCard
                    key={`${i}:${card.start}`}
                    card={card}
                    index={i}
                    path={path}
                    addingSubtask={subtaskOf?.column === c && subtaskOf.card === i}
                    onToggle={() => {
                      haptics.play('select');
                      change((t) => toggleCard(t, { column: c, card: i }));
                    }}
                    onToggleSubtask={(line) => {
                      haptics.play('select');
                      change((t) => toggleSubtask(t, line));
                    }}
                    onDeleteSubtask={(line) => change((t) => deleteSubtask(t, line))}
                    onStartSubtask={() => startSubtask({ column: c, card: i })}
                    onAddSubtask={(title) => change((t) => addSubtask(t, { column: c, card: i }, title))}
                    onEndSubtask={() => setSubtaskOf(null)}
                    onEdit={() => startEditing({ kind: 'card', ref: { column: c, card: i } })}
                  />
                ),
              )}
              {editing?.kind === 'new-card' && editing.column === c ? (
                <CardEditor
                  key={editing.key ?? 0}
                  initial=''
                  placeholder='New card'
                  onSave={(markdown, next) => {
                    change((t) => addCard(t, c, markdown));
                    // After Return, ready for the next one, as a list in a note is.
                    setEditing(next ? { kind: 'new-card', column: c, key: Date.now() } : null);
                  }}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <button type='button' className='board-add' onClick={() => startEditing({ kind: 'new-card', column: c })}>
                  <Plus className='size-4' />
                  Add card
                </button>
              )}
            </div>
          </section>
        ))}

        <div className='board-column is-new'>
          {renaming === 'new' ? (
            <NameField
              initial=''
              placeholder='Column name'
              onSave={(name) => {
                setRenaming(null);
                if (name) change((t) => addColumn(t, name));
              }}
              onCancel={() => setRenaming(null)}
            />
          ) : (
            <button type='button' className='board-add' onClick={() => startRenaming('new')}>
              <Plus className='size-4' />
              Add column
            </button>
          )}
        </div>
      </div>

      <DropdownMenu open={menu !== null} onOpenChange={(open) => !open && setMenu(null)} modal={false}>
        <DropdownMenuTrigger
          nativeButton={false}
          render={
            <span
              aria-hidden
              tabIndex={-1}
              className='pointer-events-none fixed size-px'
              style={{ left: menuAt?.x ?? 0, top: menuAt?.y ?? 0 }}
            />
          }
        />
        <DropdownMenuContent className='w-auto min-w-48'>
          {menuTarget?.kind === 'card' && (
            <>
              <DropdownMenuItem onClick={afterMenu(() => startEditing({ kind: 'card', ref: menuTarget.ref }))}>
                <PencilLine />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={afterMenu(() => startSubtask(menuTarget.ref))}>
                <ListPlus />
                Add Sub-task
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => change((t) => toggleCard(t, menuTarget.ref))}>
                {menuCard?.checked ? <Square /> : <Check />}
                {menuCard?.checked ? 'Mark Not Done' : 'Mark Done'}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  // As editing shows it: the title, then its nested lines.
                  if (menuCard) void navigator.clipboard.writeText(cardMarkdown(menuCard)).catch(() => {});
                }}
              >
                <Copy />
                Copy
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant='destructive' onClick={() => change((t) => deleteCard(t, menuTarget.ref))}>
                <Trash2 />
                Delete Card
              </DropdownMenuItem>
            </>
          )}
          {menuTarget?.kind === 'column' && (
            <>
              <DropdownMenuItem onClick={afterMenu(() => startEditing({ kind: 'new-card', column: menuTarget.column }))}>
                <Plus />
                Add Card
              </DropdownMenuItem>
              <DropdownMenuItem onClick={afterMenu(() => startRenaming(menuTarget.column))}>
                <PencilLine />
                Rename
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <CanvasColorPicker
                className='px-1.5 py-1'
                value={board.columns[menuTarget.column]?.color ?? undefined}
                onPick={(color) => {
                  setMenu(null);
                  change((t) => setColumnColor(t, menuTarget.column, color ?? null));
                }}
              />
              <DropdownMenuSeparator />
              <DropdownMenuItem variant='destructive' onClick={() => setDeleting(menuTarget.column)}>
                <Trash2 />
                Delete Column
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent size='sm'>
          <AlertDialogHeader>
            <AlertDialogMedia className='bg-destructive/10 text-destructive dark:bg-destructive/20 dark:text-destructive'>
              <Trash2Icon />
            </AlertDialogMedia>
            <AlertDialogTitle>Delete “{deleting !== null ? board.columns[deleting]?.name : ''}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The column and everything under its heading are taken out of the note. Undo brings them back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant='outline'>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={() => {
                const column = deleting;
                setDeleting(null);
                if (column !== null) change((t) => deleteColumn(t, column));
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** A column's name, edited in place: Return or leaving keeps it, Escape drops it. */
function NameField({
  initial,
  placeholder,
  onSave,
  onCancel,
}: {
  initial: string;
  placeholder?: string;
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const settled = useRef(false);
  const settle = (value: string | null) => {
    if (settled.current) return;
    settled.current = true;
    const name = value?.trim().replace(/\s+/g, ' ') ?? null;
    if (name !== null && name !== initial) onSave(name);
    else onCancel();
  };

  return (
    <input
      // Focused as it mounts, in the tap that asked (`primeKeyboard`).
      autoFocus
      className='board-name-field'
      defaultValue={initial}
      placeholder={placeholder}
      onFocus={(event) => event.currentTarget.select()}
      onBlur={(event) => settle(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
          event.preventDefault();
          settle(event.currentTarget.value);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          settle(null);
        }
      }}
    />
  );
}
