import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Copy, Hand, Plus, Redo2, Ruler, Trash2, Undo2, X } from 'lucide-react';
import { useIsMobile } from '@sunstead/ui/hooks/use-mobile';

import { Button } from '@sunstead/ui/components/button';
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
import { Popover, PopoverContent, PopoverTrigger } from '@sunstead/ui/components/popover';
import { ActionSheet } from '@/components/ui/action-sheet';
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { touchFirst } from '@/lib/backend/platform';
import { nativeInk, type Rect } from '@/lib/backend/native';
import type { MarkupSurface } from '@/lib/ink/insert';
import { createSlotGesture } from '@/lib/ink/slot-gesture';
import { INK_PALETTE, TOOL_KINDS, TOOL_LABELS, hasInk, selectedSlot, type ToolSlot } from '@/lib/ink/toolbox';
import { inkDispatch, phoneInk, useInkTools, useInkUi } from '@/lib/stores/ink-tools';
import { cn } from '@/lib/utils';
import { InsertMenu } from './insert-menu';
import { ToolAttributes } from './tool-attributes';
import { ToolIcon } from './tool-icon';

const rectOf = (el: Element): Rect => {
  const { x, y, width, height } = el.getBoundingClientRect();
  return { x, y, width, height };
};

/**
 * A fixed, invisible point for a menu or popover to hang from (a slot's
 * rect). Under `<body>`: inside a pane, `fixed` can be relative to the pane.
 * No size while closed, or it would count as an open overlay (`overlays`).
 */
function Anchor({ at, ...props }: { at: DOMRect | null } & React.ComponentProps<'span'>) {
  return createPortal(
    <span
      {...props}
      aria-hidden
      tabIndex={-1}
      className='pointer-events-none fixed'
      style={{
        left: at?.left ?? 0,
        top: at?.top ?? 0,
        width: at?.width ?? 0,
        height: at?.height ?? 0,
      }}
    />,
    document.body,
  );
}

/**
 * The ink tools, pinned under a drawing's or PDF's header (iOS, in place of
 * Apple's floating picker): undo and redo, the tool slots, colors, and the
 * ruler, finger drawing and the insert menu. Tapping the slot in hand opens its width
 * and opacity; holding a slot opens its menu or drags it along the row.
 * On a phone it's `PhoneInkBar`, at the foot.
 */
export function InkRibbon({ surface }: { surface: MarkupSurface }) {
  const phone = useIsMobile();
  return phone ? <PhoneInkBar surface={surface} /> : <WideInkRibbon surface={surface} />;
}

/** Holding a slot: drags it along the row (`createSlotGesture`), or opens its menu. */
function useSlotRow() {
  const row = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ id: string; at: DOMRect } | null>(null);
  useEffect(() => {
    const el = row.current;
    if (!el) return;
    return createSlotGesture(el, {
      move: (from, to) => inkDispatch({ type: 'move', from, to }),
      menu: (index, at) => {
        const id = useInkTools.getState().slots[index]?.id;
        if (id) setMenu({ id, at });
      },
    });
  }, []);
  return { row, menu, setMenu };
}

function WideInkRibbon({ surface }: { surface: MarkupSurface }) {
  const slots = useInkTools((s) => s.slots);
  const selected = useInkTools((s) => s.selected);
  const recentColors = useInkTools((s) => s.recentColors);
  const ruler = useInkTools((s) => s.ruler);
  const fingerDraws = useInkTools((s) => s.fingerDraws);
  const slot = useInkTools(selectedSlot);
  const canUndo = useInkUi((s) => s.canUndo);
  const canRedo = useInkUi((s) => s.canRedo);

  const { row, menu, setMenu } = useSlotRow();
  const [attributes, setAttributes] = useState<DOMRect | null>(null);
  // Where each hangs from, kept while it animates out, then let go.
  const [menuAt, setMenuAt] = useState<DOMRect | null>(null);
  if (menu && menu.at !== menuAt) setMenuAt(menu.at);
  const [attributesAt, setAttributesAt] = useState<DOMRect | null>(null);
  if (attributes && attributes !== attributesAt) setAttributesAt(attributes);

  const tapSlot = (target: ToolSlot, el: HTMLElement) => {
    if (target.id === selected) {
      // After this click: on touch, the click that opens a popover would
      // otherwise count as one outside it and close it again.
      const at = el.getBoundingClientRect();
      requestAnimationFrame(() => setAttributes(at));
    } else inkDispatch({ type: 'select', id: target.id });
  };

  const colors = [...INK_PALETTE, ...recentColors];
  const menuSlot = slots.find((s) => s.id === menu?.id);

  return (
    // The row scrolls inside a strip of its own: laid out absolutely, its
    // width never reaches the pane, which would otherwise scroll sideways.
    <div className='relative h-12 shrink-0 bg-background' role='toolbar' aria-label='Ink tools'>
      <div className='absolute inset-0 flex items-center overflow-x-auto px-2 [scrollbar-width:none]'>
        {/* Centred while it fits; `mx-auto` gives way to scrolling when it doesn't. */}
        <div className='mx-auto flex w-max items-center gap-1'>
          <Button variant='ghost' size='icon-sm' title='Undo' disabled={!canUndo} onClick={() => void nativeInk.undo()}>
            <Undo2 />
            <span className='sr-only'>Undo</span>
          </Button>
          <Button variant='ghost' size='icon-sm' title='Redo' disabled={!canRedo} onClick={() => void nativeInk.redo()}>
            <Redo2 />
            <span className='sr-only'>Redo</span>
          </Button>

          <Divider />

          <div ref={row} className='flex shrink-0 items-center gap-0.5 touch-pan-x'>
            {slots.map((s, index) => (
              <button
                key={s.id}
                type='button'
                data-slot-index={index}
                aria-pressed={s.id === selected}
                title={TOOL_LABELS[s.kind]}
                className={cn(
                  'relative grid h-10 w-9 shrink-0 place-items-center rounded-md transition-[background-color,translate] select-none [-webkit-touch-callout:none]',
                  'data-lifted:z-10 data-lifted:scale-110 data-lifted:bg-accent data-lifted:shadow-md',
                  s.id === selected
                    ? 'bg-accent text-foreground -translate-y-0.5'
                    : 'text-muted-foreground hover:bg-accent/60',
                )}
                onClick={(event) => tapSlot(s, event.currentTarget)}
              >
                <ToolIcon kind={s.kind} className='size-5' />
                {hasInk(s.kind) && (
                  <span
                    className='absolute bottom-1 h-1 w-4 rounded-full ring-1 ring-foreground/15'
                    style={{ backgroundColor: s.color, opacity: s.opacity }}
                  />
                )}
                <span className='sr-only'>{TOOL_LABELS[s.kind]}</span>
              </button>
            ))}
          </div>
          <Button
            variant='ghost'
            size='icon-sm'
            title='Add Tool'
            onClick={() => inkDispatch({ type: 'add', newId: crypto.randomUUID() })}
          >
            <Plus />
            <span className='sr-only'>Add Tool</span>
          </Button>

          <Divider />

          <div className='flex shrink-0 items-center gap-1' role='radiogroup' aria-label='Color'>
            {colors.map((color) => {
              const on = hasInk(slot.kind) && slot.color === color;
              return (
                <button
                  key={color}
                  type='button'
                  role='radio'
                  aria-checked={on}
                  aria-label={color}
                  disabled={!hasInk(slot.kind)}
                  className={cn(
                    'size-6 shrink-0 rounded-full ring-1 ring-foreground/20 ring-inset disabled:opacity-40',
                    on && 'outline-2 outline-offset-2 outline-foreground',
                  )}
                  style={{ backgroundColor: color }}
                  onClick={() => inkDispatch({ type: 'setColor', color })}
                />
              );
            })}
            <button
              type='button'
              title='More Colors'
              disabled={!hasInk(slot.kind)}
              className='size-6 shrink-0 rounded-full ring-1 ring-foreground/20 disabled:opacity-40'
              style={{
                background: 'conic-gradient(#ff3b30, #ffcc00, #34c759, #0a84ff, #af52de, #ff3b30)',
              }}
              onClick={(event) => void nativeInk.pickColor(rectOf(event.currentTarget))}
            >
              <span className='sr-only'>More Colors</span>
            </button>
          </div>

          <Divider />

          <Button
            variant={ruler ? 'secondary' : 'ghost'}
            size='icon-sm'
            title='Ruler'
            aria-pressed={ruler}
            onClick={() => inkDispatch({ type: 'toggleRuler' })}
          >
            <Ruler />
            <span className='sr-only'>Ruler</span>
          </Button>
          {!phoneInk && (
          <Button
            variant={fingerDraws ? 'secondary' : 'ghost'}
            size='icon-sm'
            title='Draw with Finger'
            aria-pressed={fingerDraws}
            onClick={() => inkDispatch({ type: 'setFingerDraws', on: !fingerDraws })}
          >
            <Hand />
            <span className='sr-only'>Draw with Finger</span>
          </Button>
          )}
          <InsertMenu surface={surface} />

          <Popover
            open={attributes !== null}
            onOpenChange={(open) => !open && setAttributes(null)}
            onOpenChangeComplete={(open) => !open && setAttributesAt(null)}
          >
            <PopoverTrigger nativeButton={false} render={<Anchor at={attributesAt} />} />
            {/* Solid: a blur can't see the native canvas under the webview. */}
            <PopoverContent className='w-64 bg-popover' side='bottom'>
              <ToolAttributes slot={slot} />
            </PopoverContent>
          </Popover>

          {touchFirst ? (
            <SlotSheet id={menu?.id ?? null} onClose={() => setMenu(null)} />
          ) : (
          <DropdownMenu
            open={menu !== null}
            onOpenChange={(open) => !open && setMenu(null)}
            onOpenChangeComplete={(open) => !open && setMenuAt(null)}
          >
            <DropdownMenuTrigger nativeButton={false} render={<Anchor at={menuAt} />} />
            <DropdownMenuContent className='w-auto min-w-48'>
              <DropdownMenuItem
                onClick={() =>
                  menuSlot &&
                  inkDispatch({
                    type: 'duplicate',
                    id: menuSlot.id,
                    newId: crypto.randomUUID(),
                  })
                }
              >
                <Copy />
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  {menuSlot && <ToolIcon kind={menuSlot.kind} />}
                  Change Tool
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {TOOL_KINDS.map((kind) => (
                    <DropdownMenuItem
                      key={kind}
                      disabled={menuSlot?.kind === kind}
                      onClick={() => menuSlot && inkDispatch({ type: 'changeKind', id: menuSlot.id, kind })}
                    >
                      <ToolIcon kind={kind} />
                      {TOOL_LABELS[kind]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant='destructive'
                disabled={slots.length === 1}
                onClick={() => menuSlot && inkDispatch({ type: 'remove', id: menuSlot.id })}
              >
                <Trash2 />
                Remove
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          )}
        </div>
      </div>
    </div>
  );
}

function Divider() {
  return <span aria-hidden className='mx-1 h-6 w-px shrink-0 bg-border' />;
}

/** A slot's menu as an action sheet: Duplicate, Change Tool, Remove. */
function SlotSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const slots = useInkTools((s) => s.slots);
  const slot = slots.find((s) => s.id === id);
  // Kept while it slides away, so its rows don't empty under it.
  const [shown, setShown] = useState<ToolSlot | null>(null);
  if (slot && slot !== shown) setShown(slot);
  const target = slot ?? shown;
  return (
    <ActionSheet
      open={id !== null}
      onOpenChange={(open) => !open && onClose()}
      title={target ? TOOL_LABELS[target.kind] : 'Tool'}
      groups={[
        [
          {
            id: 'duplicate',
            label: 'Duplicate',
            icon: Copy,
            onSelect: () => target && inkDispatch({ type: 'duplicate', id: target.id, newId: crypto.randomUUID() }),
          },
          {
            id: 'change',
            label: 'Change Tool',
            icon: target ? (props) => <ToolIcon kind={target.kind} {...props} /> : undefined,
            items: TOOL_KINDS.map((kind) => ({
              id: kind,
              label: TOOL_LABELS[kind],
              icon: (props) => <ToolIcon kind={kind} {...props} />,
              disabled: target?.kind === kind,
              onSelect: () => target && inkDispatch({ type: 'changeKind', id: target.id, kind }),
            })),
          },
        ],
        [
          {
            id: 'remove',
            label: 'Remove',
            icon: Trash2,
            destructive: true,
            disabled: slots.length === 1,
            onSelect: () => target && inkDispatch({ type: 'remove', id: target.id }),
          },
        ],
      ]}
    />
  );
}

/**
 * The ink tools on a phone, at the foot as Notes has them, in reach of a
 * thumb and sized for one: undo and redo, the tool slots, then the ink in
 * hand (its color, width and opacity, in a sheet) and the insert sheet,
 * where the ruler is too. Finger drawing has no button here: showing the
 * tools is what makes a finger draw (`phoneInk`).
 */
function PhoneInkBar({ surface }: { surface: MarkupSurface }) {
  const slots = useInkTools((s) => s.slots);
  const selected = useInkTools((s) => s.selected);
  const ruler = useInkTools((s) => s.ruler);
  const slot = useInkTools(selectedSlot);
  const canUndo = useInkUi((s) => s.canUndo);
  const canRedo = useInkUi((s) => s.canRedo);
  const { row, menu, setMenu } = useSlotRow();
  const [inkOpen, setInkOpen] = useState(false);
  const colorButton = useRef<HTMLButtonElement>(null);

  const big = 'size-11 shrink-0 rounded-full [&_svg]:size-6';
  return (
    <div className='relative h-16 shrink-0 border-t bg-background' role='toolbar' aria-label='Ink tools'>
      <div className='absolute inset-0 flex items-center gap-1 px-2'>
        <Button variant='ghost' className={big} title='Undo' disabled={!canUndo} onClick={() => void nativeInk.undo()}>
          <Undo2 />
          <span className='sr-only'>Undo</span>
        </Button>
        <Button variant='ghost' className={big} title='Redo' disabled={!canRedo} onClick={() => void nativeInk.redo()}>
          <Redo2 />
          <span className='sr-only'>Redo</span>
        </Button>

        <div className='flex min-w-0 flex-1 items-center overflow-x-auto [scrollbar-width:none]'>
          <div ref={row} className='mx-auto flex w-max items-center gap-1 touch-pan-x'>
            {slots.map((s, index) => (
              <button
                key={s.id}
                type='button'
                data-slot-index={index}
                aria-pressed={s.id === selected}
                title={TOOL_LABELS[s.kind]}
                className={cn(
                  'relative grid h-13 w-11 shrink-0 place-items-center rounded-xl transition-[background-color,translate] select-none [-webkit-touch-callout:none]',
                  'data-lifted:z-10 data-lifted:scale-110 data-lifted:bg-accent data-lifted:shadow-md',
                  s.id === selected ? 'bg-accent text-foreground -translate-y-1' : 'text-muted-foreground',
                )}
                onClick={() => (s.id === selected ? setInkOpen(true) : inkDispatch({ type: 'select', id: s.id }))}
              >
                <ToolIcon kind={s.kind} className='size-6' />
                {hasInk(s.kind) && (
                  <span
                    className='absolute bottom-1.5 h-1 w-5 rounded-full ring-1 ring-foreground/15'
                    style={{ backgroundColor: s.color, opacity: s.opacity }}
                  />
                )}
                <span className='sr-only'>{TOOL_LABELS[s.kind]}</span>
              </button>
            ))}
            <Button
              variant='ghost'
              className={big}
              title='Add Tool'
              onClick={() => inkDispatch({ type: 'add', newId: crypto.randomUUID() })}
            >
              <Plus />
              <span className='sr-only'>Add Tool</span>
            </Button>
          </div>
        </div>

        <button
          ref={colorButton}
          type='button'
          title='Color and Width'
          disabled={slot.kind === 'lasso'}
          className='grid size-11 shrink-0 place-items-center rounded-full disabled:opacity-40'
          onClick={() => setInkOpen(true)}
        >
          <span
            className='size-8 rounded-full ring-2 ring-foreground/20 ring-offset-2 ring-offset-background'
            style={{ backgroundColor: hasInk(slot.kind) ? slot.color : 'var(--muted)' }}
          />
          <span className='sr-only'>Color and Width</span>
        </button>
        <InsertMenu
          surface={surface}
          className={big}
          extra={[
            {
              id: 'ruler',
              label: ruler ? 'Hide Ruler' : 'Show Ruler',
              icon: Ruler,
              onSelect: () => inkDispatch({ type: 'toggleRuler' }),
            },
          ]}
        />
      </div>

      <InkSheet open={inkOpen} onOpenChange={setInkOpen} slot={slot} colorButton={colorButton} />
      <SlotSheet id={menu?.id ?? null} onClose={() => setMenu(null)} />
    </div>
  );
}

/** The ink in hand, from the phone's bar: its colors, then its width and opacity. */
function InkSheet({
  open,
  onOpenChange,
  slot,
  colorButton,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slot: ToolSlot;
  colorButton: React.RefObject<HTMLButtonElement | null>;
}) {
  const recentColors = useInkTools((s) => s.recentColors);
  const colors = [...INK_PALETTE, ...recentColors];
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side='bottom'
        showCloseButton={false}
        finalFocus={false}
        className='gap-0 rounded-t-2xl bg-sidebar pb-[calc(1rem+env(safe-area-inset-bottom))]'
      >
        <div className='flex items-center gap-2 px-5 pt-5 pb-3'>
          <SheetTitle className='min-w-0 flex-1 truncate text-[17px] font-semibold'>{TOOL_LABELS[slot.kind]}</SheetTitle>
          <SheetClose className='-mr-1 grid size-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground active:opacity-60'>
            <X className='size-4' />
            <span className='sr-only'>Close</span>
          </SheetClose>
        </div>
        <SheetDescription className='sr-only'>The color, width and opacity of the tool in hand</SheetDescription>
        <div className='flex flex-col gap-5 px-5'>
          {hasInk(slot.kind) && (
            <div className='grid grid-cols-6 justify-items-center gap-3' role='radiogroup' aria-label='Color'>
              {colors.map((color) => {
                const on = slot.color === color;
                return (
                  <button
                    key={color}
                    type='button'
                    role='radio'
                    aria-checked={on}
                    aria-label={color}
                    className={cn(
                      'size-11 rounded-full ring-1 ring-foreground/20 ring-inset',
                      on && 'outline-2 outline-offset-3 outline-foreground',
                    )}
                    style={{ backgroundColor: color }}
                    onClick={() => inkDispatch({ type: 'setColor', color })}
                  />
                );
              })}
              <button
                type='button'
                title='More Colors'
                className='size-11 rounded-full ring-1 ring-foreground/20'
                style={{ background: 'conic-gradient(#ff3b30, #ffcc00, #34c759, #0a84ff, #af52de, #ff3b30)' }}
                onClick={() => {
                  // Apple's picker comes up over the app: this sheet makes way first.
                  onOpenChange(false);
                  const el = colorButton.current;
                  if (el) void nativeInk.pickColor(rectOf(el));
                }}
              >
                <span className='sr-only'>More Colors</span>
              </button>
            </div>
          )}
          <ToolAttributes slot={slot} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
