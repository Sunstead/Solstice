import { useEffect, useState, useSyncExternalStore, type ComponentType } from 'react';
import {
  Bold,
  Brackets,
  ChevronLeft,
  Code,
  Heading,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Image,
  Italic,
  KeyboardOff,
  List,
  ListIndentDecrease,
  ListIndentIncrease,
  ListOrdered,
  ListTodo,
  Pilcrow,
  Quote,
  Redo2,
  SquareCode,
  Strikethrough,
  Undo2,
} from 'lucide-react';

import { useViewport } from '@/hooks/use-visual-viewport';
import { isCommandEnabled, runCommand, type ScopedCommandId } from '@/lib/commands';
import { useActiveEditorStore } from '@/lib/stores/active-editor';
import { cn } from '@/lib/utils';

type Item = { icon: ComponentType<{ className?: string }>; label: string; id: ScopedCommandId };

const MAIN: Item[] = [
  { icon: Undo2, label: 'Undo', id: 'native.undo' },
  { icon: Redo2, label: 'Redo', id: 'native.redo' },
  { icon: Bold, label: 'Bold', id: 'edit.bold' },
  { icon: Italic, label: 'Italic', id: 'edit.italic' },
  { icon: Strikethrough, label: 'Strikethrough', id: 'edit.strikethrough' },
  { icon: Highlighter, label: 'Highlight', id: 'edit.highlight' },
  { icon: Code, label: 'Inline code', id: 'edit.inline_code' },
  { icon: List, label: 'Bullet list', id: 'edit.bullet_list' },
  { icon: ListOrdered, label: 'Ordered list', id: 'edit.ordered_list' },
  { icon: ListTodo, label: 'Task list', id: 'edit.task_list' },
  { icon: ListIndentIncrease, label: 'Indent', id: 'edit.indent' },
  { icon: ListIndentDecrease, label: 'Outdent', id: 'edit.outdent' },
  { icon: Brackets, label: 'Link to note', id: 'edit.insert_wikilink' },
  { icon: Quote, label: 'Blockquote', id: 'edit.blockquote' },
  { icon: SquareCode, label: 'Code block', id: 'edit.code_block' },
  { icon: Image, label: 'Image', id: 'edit.insert_image' },
];

const HEADINGS: Item[] = [
  { icon: Heading1, label: 'Heading 1', id: 'edit.heading1' },
  { icon: Heading2, label: 'Heading 2', id: 'edit.heading2' },
  { icon: Heading3, label: 'Heading 3', id: 'edit.heading3' },
  { icon: Pilcrow, label: 'Paragraph', id: 'edit.paragraph' },
];

const coarse = typeof window !== 'undefined' ? window.matchMedia('(pointer: coarse)') : null;
const subscribeCoarse = (onChange: () => void) => {
  coarse?.addEventListener('change', onChange);
  return () => coarse?.removeEventListener('change', onChange);
};

/** Whether focus is in a note editor (a tab's or a canvas card's). */
function useEditorFocused() {
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    const check = () =>
      setFocused(!!document.activeElement?.closest('.ProseMirror[data-command-surface]'));
    document.addEventListener('focusin', check);
    document.addEventListener('focusout', check);
    return () => {
      document.removeEventListener('focusin', check);
      document.removeEventListener('focusout', check);
    };
  }, []);
  return focused;
}

/**
 * Formatting above the on-screen keyboard, while a note is being edited on a
 * touch screen. The commands are the menu's and the shortcuts'; this is just
 * somewhere to reach them without a keyboard (Tab included).
 */
export function KeyboardBar() {
  const keyboard = useViewport((s) => s.keyboard);
  const touch = useSyncExternalStore(subscribeCoarse, () => !!coarse?.matches, () => false);
  const focused = useEditorFocused();
  const [headings, setHeadings] = useState(false);
  // Re-render as the selection moves, for the pressed and disabled states.
  useActiveEditorStore((s) => s.commandStateVersion);
  const formats = useActiveEditorStore((s) => s.activeFormats);

  if (!keyboard || !touch || !focused) return null;

  // Taps mustn't take focus from the editor, or the keyboard drops.
  const keep = (e: React.SyntheticEvent) => e.preventDefault();
  const button = (
    key: string,
    label: string,
    Icon: Item['icon'],
    onPress: () => void,
    state: { pressed?: boolean; disabled?: boolean } = {},
  ) => (
    <button
      key={key}
      type='button'
      aria-label={label}
      aria-pressed={state.pressed}
      aria-disabled={state.disabled}
      className={cn(
        'flex size-11 shrink-0 items-center justify-center rounded-md text-foreground/80 active:bg-accent',
        state.pressed && 'bg-accent text-foreground',
        state.disabled && 'text-foreground/30 active:bg-transparent',
      )}
      onPointerDown={keep}
      onMouseDown={keep}
      onClick={onPress}
    >
      <Icon className='size-5' />
    </button>
  );
  const run = (item: Item) =>
    button(
      item.id,
      item.label,
      item.icon,
      () => {
        setHeadings(false);
        void runCommand(item.id);
      },
      { pressed: formats.has(item.id), disabled: !isCommandEnabled(item.id) },
    );

  return (
    // A box exactly as tall as its buttons, scrolling sideways only: anything
    // taller rubber-bands up and down under a thumb.
    <div className='flex shrink-0 box-content h-11 items-center border-t bg-sidebar select-none'>
      <div
        // Remounted per row, so each starts scrolled to its beginning.
        key={headings ? 'headings' : 'main'}
        role='toolbar'
        aria-label='Formatting'
        className='flex h-full min-w-0 flex-1 items-center overflow-x-auto overflow-y-hidden overscroll-contain px-1 touch-pan-x [scrollbar-width:none]'
      >
        {headings ? (
          <>
            {button('back', 'Back', ChevronLeft, () => setHeadings(false))}
            {HEADINGS.map(run)}
          </>
        ) : (
          <>
            {button('headings', 'Headings', Heading, () => setHeadings(true), {
              pressed: [...formats].some((id) => id.startsWith('edit.heading')),
            })}
            {MAIN.map(run)}
          </>
        )}
      </div>
      <div className='h-6 w-px shrink-0 bg-border' />
      <div className='px-1'>
        {button('hide', 'Hide keyboard', KeyboardOff, () => (document.activeElement as HTMLElement | null)?.blur())}
      </div>
    </div>
  );
}
