import { useEffect, useRef } from 'react';
import { Check, ListPlus, X } from 'lucide-react';

import { StaticMarkdown } from '@/components/canvas/static-markdown';
import { openWikilink } from '@/lib/wikilink';
import type { Card } from '@/lib/task-board/parse';
import { cn } from '@/lib/utils';

/** A mouse's second click edits, so its first waits this long to tick. */
const DOUBLE_CLICK_MS = 250;

const isMouse = () => document.documentElement.dataset.pointer === 'mouse';

/** Opens a link a click landed on; returns whether it did. */
function openLinkAt(event: React.MouseEvent): boolean {
  const link = (event.target as Element).closest<HTMLElement>('[data-static-wikilink]');
  if (!link) return false;
  event.preventDefault();
  event.stopPropagation();
  openWikilink(link.dataset.staticWikilink ?? '');
  return true;
}

/**
 * One card: its title and notes rendered as a note would render them, then
 * its sub-tasks as rows to tick, add to and take out. A click ticks the card
 * (a mouse's double click edits it instead); its links open.
 */
export function BoardCard({
  card,
  index,
  path,
  addingSubtask,
  onToggle,
  onToggleSubtask,
  onDeleteSubtask,
  onStartSubtask,
  onAddSubtask,
  onEndSubtask,
  onEdit,
}: {
  card: Card;
  index: number;
  path: string;
  /** Whether its new sub-task field is open. */
  addingSubtask: boolean;
  onToggle: () => void;
  onToggleSubtask: (line: number) => void;
  onDeleteSubtask: (line: number) => void;
  onStartSubtask: () => void;
  onAddSubtask: (title: string) => void;
  onEndSubtask: () => void;
  onEdit: () => void;
}) {
  const done = card.subtasks.filter((s) => s.checked).length;
  const pending = useRef(0);

  useEffect(() => () => clearTimeout(pending.current), []);

  const onClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (openLinkAt(event)) return;
    clearTimeout(pending.current);
    if (!isMouse()) onToggle();
    else if (event.detail === 1) pending.current = window.setTimeout(onToggle, DOUBLE_CLICK_MS);
  };

  return (
    <div
      data-card={index}
      data-checked={card.checked || undefined}
      className='board-card'
      onClick={onClick}
      onDoubleClick={() => {
        clearTimeout(pending.current);
        onEdit();
      }}
    >
      <div className='board-card-head'>
        <span className='board-check' aria-hidden>
          {card.checked && <Check className='size-3' strokeWidth={3} />}
        </span>
        <div className='min-w-0 flex-1'>
          <StaticMarkdown markdown={card.title || ' '} sourcePath={path} className='board-card-text board-card-title' />
          {card.notes && <StaticMarkdown markdown={card.notes} sourcePath={path} className='board-card-text board-card-notes' />}
        </div>
        <button
          type='button'
          className='board-card-action'
          aria-label='Add sub-task'
          title='Add sub-task'
          onClick={(event) => {
            event.stopPropagation();
            onStartSubtask();
          }}
        >
          <ListPlus className='size-3.5' />
        </button>
      </div>

      {(card.subtasks.length > 0 || addingSubtask) && (
        <ul className='board-subtasks'>
          {card.subtasks.map((subtask) => (
            <li
              key={subtask.line}
              className='board-subtask'
              data-checked={subtask.checked || undefined}
              onClick={(event) => {
                event.stopPropagation();
                if (!openLinkAt(event)) onToggleSubtask(subtask.line);
              }}
              onDoubleClick={(event) => event.stopPropagation()}
            >
              <span className='board-check' aria-hidden>
                {subtask.checked && <Check className='size-2.5' strokeWidth={3} />}
              </span>
              <StaticMarkdown markdown={subtask.text || ' '} sourcePath={path} className='board-card-text min-w-0 flex-1' />
              <button
                type='button'
                className='board-subtask-delete'
                aria-label='Delete sub-task'
                onClick={(event) => {
                  event.stopPropagation();
                  onDeleteSubtask(subtask.line);
                }}
              >
                <X className='size-3' />
              </button>
            </li>
          ))}
          {addingSubtask && <SubtaskField onAdd={onAddSubtask} onEnd={onEndSubtask} />}
        </ul>
      )}

      {card.subtasks.length > 0 && (
        <span className={cn('board-count', done === card.subtasks.length && 'is-done')}>
          {done}/{card.subtasks.length}
        </span>
      )}
    </div>
  );
}

/** A new sub-task's title: Return adds it and leaves the field for the next, Escape or leaving ends. */
function SubtaskField({ onAdd, onEnd }: { onAdd: (title: string) => void; onEnd: () => void }) {
  return (
    <li className='board-subtask is-new' onClick={(event) => event.stopPropagation()}>
      <span className='board-check' aria-hidden />
      <input
        // Focused as it mounts, in the tap that asked (`primeKeyboard`).
        autoFocus
        className='board-subtask-field'
        placeholder='Sub-task'
        onBlur={(event) => {
          const title = event.currentTarget.value.trim();
          if (title) onAdd(title);
          onEnd();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault();
            const title = event.currentTarget.value.trim();
            if (title) onAdd(title);
            event.currentTarget.value = '';
          } else if (event.key === 'Escape') {
            event.preventDefault();
            event.currentTarget.value = '';
            event.currentTarget.blur();
          }
        }}
      />
    </li>
  );
}

/**
 * A card's markdown in a plain field, as tall as its text: Return keeps it,
 * Shift+Return is a new line, Escape drops the change, and leaving keeps it.
 */
export function CardEditor({
  initial,
  placeholder,
  onSave,
  onCancel,
}: {
  initial: string;
  placeholder?: string;
  /** `next`: kept with Return, so another can follow. */
  onSave: (markdown: string, next: boolean) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const settled = useRef(false);

  // `scrollHeight` leaves out the borders, which a border-box height takes in:
  // without them one line overflows by two pixels and scrolls.
  const fit = () => {
    const field = ref.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${field.scrollHeight + field.offsetHeight - field.clientHeight}px`;
  };

  useEffect(() => {
    const field = ref.current;
    if (!field) return;
    fit();
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  }, []);

  const settle = (save: boolean, next = false) => {
    if (settled.current) return;
    settled.current = true;
    const value = ref.current?.value.replace(/\s+$/, '') ?? '';
    if (save && value !== initial) onSave(value, next);
    else onCancel();
  };

  return (
    <textarea
      ref={ref}
      className='board-editor'
      defaultValue={initial}
      placeholder={placeholder}
      rows={1}
      onInput={fit}
      onBlur={() => settle(true)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
          event.preventDefault();
          settle(true, true);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          settle(false);
        }
      }}
    />
  );
}
