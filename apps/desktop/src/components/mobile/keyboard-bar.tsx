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
import { runCommand, type ScopedCommandId } from '@/lib/commands';

type Item = { icon: ComponentType<{ className?: string }>; label: string; id: ScopedCommandId };

const MAIN: Item[] = [
  { icon: Undo2, label: 'Undo', id: 'native.undo' },
  { icon: Redo2, label: 'Redo', id: 'native.redo' },
  { icon: Bold, label: 'Bold', id: 'edit.bold' },
  { icon: Italic, label: 'Italic', id: 'edit.italic' },
  { icon: Strikethrough, label: 'Strikethrough', id: 'edit.strikethrough' },
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

  if (!keyboard || !touch || !focused) return null;

  // Taps mustn't take focus from the editor, or the keyboard drops.
  const keep = (e: React.SyntheticEvent) => e.preventDefault();
  const button = (key: string, label: string, Icon: Item['icon'], onPress: () => void) => (
    <button
      key={key}
      type='button'
      aria-label={label}
      className='flex size-11 shrink-0 items-center justify-center rounded-md text-foreground/80 active:bg-accent'
      onPointerDown={keep}
      onMouseDown={keep}
      onClick={onPress}
    >
      <Icon className='size-5' />
    </button>
  );
  const run = (item: Item) =>
    button(item.id, item.label, item.icon, () => {
      setHeadings(false);
      void runCommand(item.id);
    });

  return (
    <div
      // Remounted per row, so each starts scrolled to its beginning.
      key={headings ? 'headings' : 'main'}
      role='toolbar'
      aria-label='Formatting'
      className='flex h-11 shrink-0 items-center overflow-x-auto overscroll-x-contain border-t bg-sidebar px-1 select-none [scrollbar-width:none]'
    >
      {headings ? (
        <>
          {button('back', 'Back', ChevronLeft, () => setHeadings(false))}
          {HEADINGS.map(run)}
        </>
      ) : (
        <>
          {button('headings', 'Headings', Heading, () => setHeadings(true))}
          {MAIN.map(run)}
        </>
      )}
      <div className='flex-1' />
      {button('hide', 'Hide keyboard', KeyboardOff, () => (document.activeElement as HTMLElement | null)?.blur())}
    </div>
  );
}
