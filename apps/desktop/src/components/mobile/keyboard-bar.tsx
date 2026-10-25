import { useState, type ComponentType } from 'react';
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
  Type,
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

import { useIsMobile } from '@sunstead/ui/hooks/use-mobile';
import { KEYBOARD_BAR_GAP_PX, KEYBOARD_BAR_PX, useEditingFocus, useKeyboard, useKeyboardBarShown, useRect } from '@/lib/keyboard';
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

/** A phone's bar, as Notes': the few things reached for while typing. */
const PHONE_MAIN: Item[] = [
  { icon: ListTodo, label: 'Task list', id: 'edit.task_list' },
  { icon: List, label: 'Bullet list', id: 'edit.bullet_list' },
  { icon: Brackets, label: 'Link to note', id: 'edit.insert_wikilink' },
  { icon: Image, label: 'Image', id: 'edit.insert_image' },
  { icon: Undo2, label: 'Undo', id: 'native.undo' },
  { icon: Redo2, label: 'Redo', id: 'native.redo' },
];

/** What its Aa opens, a row at a time. */
const PHONE_FORMATS: Item[][] = [
  [
    { icon: Heading1, label: 'Title', id: 'edit.heading1' },
    { icon: Heading2, label: 'Heading', id: 'edit.heading2' },
    { icon: Heading3, label: 'Subheading', id: 'edit.heading3' },
    { icon: Pilcrow, label: 'Body', id: 'edit.paragraph' },
  ],
  [
    { icon: Bold, label: 'Bold', id: 'edit.bold' },
    { icon: Italic, label: 'Italic', id: 'edit.italic' },
    { icon: Strikethrough, label: 'Strikethrough', id: 'edit.strikethrough' },
    { icon: Highlighter, label: 'Highlight', id: 'edit.highlight' },
    { icon: Code, label: 'Inline code', id: 'edit.inline_code' },
  ],
  [
    { icon: List, label: 'Bullet list', id: 'edit.bullet_list' },
    { icon: ListOrdered, label: 'Ordered list', id: 'edit.ordered_list' },
    { icon: ListTodo, label: 'Task list', id: 'edit.task_list' },
    { icon: ListIndentDecrease, label: 'Outdent', id: 'edit.outdent' },
    { icon: ListIndentIncrease, label: 'Indent', id: 'edit.indent' },
  ],
  [
    { icon: Quote, label: 'Blockquote', id: 'edit.blockquote' },
    { icon: SquareCode, label: 'Code block', id: 'edit.code_block' },
  ],
];

const HEADINGS: Item[] = [
  { icon: Heading1, label: 'Heading 1', id: 'edit.heading1' },
  { icon: Heading2, label: 'Heading 2', id: 'edit.heading2' },
  { icon: Heading3, label: 'Heading 3', id: 'edit.heading3' },
  { icon: Pilcrow, label: 'Paragraph', id: 'edit.paragraph' },
];

/**
 * Formatting while a note is being edited on a touch screen, whatever's
 * typing: on top of a docked on-screen keyboard, or along the foot of the
 * note's pane with a floating or hardware keyboard, or the Pencil. The
 * commands are the menu's and the shortcuts'; this is just somewhere to reach
 * them without a keyboard (Tab included). It floats, so nothing moves for
 * it: the note's pane makes room (`useKeyboardRoom`).
 */
export function KeyboardBar() {
  const shown = useKeyboardBarShown();
  const { inset, docked } = useKeyboard();
  const focus = useEditingFocus((s) => s.element);
  // The pane the note's in: its scroll area, else a canvas card's tab.
  const pane = shown ? (focus?.closest<HTMLElement>("[data-slot='scroll-area'], .flexlayout__tab") ?? null) : null;
  const rect = useRect(docked ? null : pane);
  const [headings, setHeadings] = useState(false);
  const phone = useIsMobile();
  const [formatting, setFormatting] = useState(false);
  // Re-render as the selection moves, for the pressed and disabled states.
  useActiveEditorStore((s) => s.commandStateVersion);
  const formats = useActiveEditorStore((s) => s.activeFormats);

  if (!shown) return null;

  const place: React.CSSProperties = docked
    ? { left: 0, right: 0, bottom: inset }
    : rect
      ? {
          left: rect.left + KEYBOARD_BAR_GAP_PX,
          width: rect.width - 2 * KEYBOARD_BAR_GAP_PX,
          bottom: `calc(max(${Math.max(0, window.innerHeight - rect.bottom)}px, env(safe-area-inset-bottom)) + ${KEYBOARD_BAR_GAP_PX}px)`,
        }
      : { left: 0, right: 0, bottom: 'env(safe-area-inset-bottom)' };

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

  if (phone) {
    const hide = () => {
      setFormatting(false);
      (document.activeElement as HTMLElement | null)?.blur();
    };
    // A glass capsule over the keyboard, Notes': Aa opens the formats above
    // it, as a panel, since a sheet would take focus and the keyboard.
    return (
      <div className='fixed z-40 select-none px-2 [&_button]:rounded-full' style={{ ...place, height: KEYBOARD_BAR_PX }}>
        {formatting && (
          <div
            role='toolbar'
            aria-label='Formats'
            className='phone-glass absolute inset-x-2 bottom-[calc(100%+0.375rem)] flex flex-col gap-1 rounded-3xl p-2'
          >
            {PHONE_FORMATS.map((row, i) => (
              <div key={i} className='flex items-center justify-around'>
                {row.map(run)}
              </div>
            ))}
          </div>
        )}
        <div role='toolbar' aria-label='Formatting' className='phone-glass flex h-full items-center justify-between rounded-full px-1'>
          {button('formats', 'Formats', Type, () => setFormatting((f) => !f), { pressed: formatting })}
          {PHONE_MAIN.map(run)}
          {button('hide', 'Hide keyboard', KeyboardOff, hide)}
        </div>
      </div>
    );
  }

  return (
    // A box exactly as tall as its buttons, scrolling sideways only: anything
    // taller rubber-bands up and down under a thumb.
    <div
      className={cn(
        'fixed z-40 flex box-content items-center bg-sidebar select-none',
        docked ? 'border-t' : 'border rounded-lg shadow-sm',
      )}
      style={{ ...place, height: KEYBOARD_BAR_PX }}
    >
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
