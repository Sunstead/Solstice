import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Ellipsis, Redo2, Undo2 } from 'lucide-react';

import { nativeInk } from '@/lib/backend/native';
import { haptics } from '@/lib/haptics';
import { usePaperColor } from '@/lib/ink/paper-color';
import { arcDirection, bandPath, fan, place, polar, type Point } from '@/lib/ink/radial';
import {
  INK_PALETTE,
  TOOL_LABELS,
  hasInk,
  presetWidths,
  selectedSlot,
  type PalettePage,
  type ToolSlot,
} from '@/lib/ink/toolbox';
import { inkDispatch, useInkTools, useInkUi } from '@/lib/stores/ink-tools';
import { cn } from '@/lib/utils';
import { ToolIcon } from './tool-icon';

/** The arc's buttons sit this far from the Pencil, this far apart. */
const ARC = 90;
const ARC_STEP = 0.5;
/** A fan's choices sit beyond the arc. */
const FAN = 146;
const FAN_STEP = 0.34;
const BUTTON = 44;
/** The band behind the buttons: a little wider than them, with round ends. */
const BAND = BUTTON + 12;
const REACH = FAN + BUTTON / 2 + 8;
const SIZE = REACH * 2;
/** How many recent tools the arc shows; the rest are behind More. */
const RECENT = 3;

/** Apple's decelerating spring, as a curve (as `tab-gesture.ts`). */
const SPRING = 'cubic-bezier(0.2, 0.9, 0.25, 1.15)';

const close = () => useInkUi.setState({ palette: null });
const setPage = (page: PalettePage) => useInkUi.setState((s) => (s.palette ? { palette: { ...s.palette, page } } : s));
const toggle = (page: PalettePage, current: PalettePage) => setPage(current === page ? 'tools' : page);

/**
 * The Pencil's squeeze palette, Solstice's in place of Apple's: an arc of
 * round buttons beside the Pencil, opening away from the hand (`arcDirection`):
 * undo and redo, the recent tools, More and the color. The color, More and
 * the tool in hand (its widths) fan their choices out beyond it, the same way
 * round. Under
 * `<body>`, so the webview takes every touch while it's open (`overlays`) and a
 * touch anywhere else, a Pencil stroke included, puts it away.
 */
export function SqueezePalette() {
  const palette = useInkUi((s) => s.palette);
  // Kept while it animates out.
  const [shown, setShown] = useState(palette);
  if (palette && palette !== shown) setShown(palette);
  const box = useRef<HTMLDivElement>(null);
  const opened = palette !== null;

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    // The box only scales; each piece fades itself. An ancestor fading
    // (opacity under 1) would leave the band's backdrop blur nothing to
    // blur until it ended, so the blur would pop in.
    const pieces = [...el.children];
    if (opened) {
      haptics.play('lift');
      el.animate([{ scale: 0.6 }, { scale: 1 }], { duration: 260, easing: SPRING });
      pieces.forEach((piece) => piece.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' }));
    } else {
      el.animate([{ scale: 1 }, { scale: 0.7 }], { duration: 140, easing: 'ease-in', fill: 'forwards' }).onfinish =
        () => setShown(null);
      pieces.forEach((piece) =>
        piece.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, easing: 'ease-in', fill: 'forwards' }),
      );
    }
  }, [opened]);

  useEffect(() => {
    if (!opened) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [opened]);

  if (!shown) return null;
  // A page that isn't shown yet can report no size; the document still has one.
  const root = document.documentElement;
  const viewport = {
    width: window.innerWidth || root.clientWidth,
    height: window.innerHeight || root.clientHeight,
  };
  const at = place(shown, REACH, viewport, 8);
  return createPortal(
    <div className='fixed inset-0 z-50' onPointerDown={(event) => event.target === event.currentTarget && close()}>
      <div
        ref={box}
        className='pointer-events-none absolute'
        style={{
          left: at.x - REACH,
          top: at.y - REACH,
          width: SIZE,
          height: SIZE,
        }}
      >
        <Arc page={shown.page} direction={arcDirection(shown.azimuth)} />
      </div>
    </div>,
    document.body,
  );
}

type Item =
  { type: 'undo' } | { type: 'redo' } | { type: 'tool'; slot: ToolSlot } | { type: 'colors' } | { type: 'more' };

function Arc({ page, direction }: { page: PalettePage; direction: number }) {
  const onPaper = usePaperColor();
  const slots = useInkTools((s) => s.slots);
  const recents = useInkTools((s) => s.recents);
  const recentColors = useInkTools((s) => s.recentColors);
  const slot = useInkTools(selectedSlot);
  const canUndo = useInkUi((s) => s.canUndo);
  const canRedo = useInkUi((s) => s.canRedo);

  // The recent tools, topped up from the row, the one in hand among them.
  const ids = [slot.id, ...recents, ...slots.map((s) => s.id)].filter((id, i, all) => all.indexOf(id) === i);
  const shownTools = ids.slice(0, RECENT).flatMap((id) => slots.filter((s) => s.id === id));
  const others = slots.filter((s) => !shownTools.includes(s));

  const items: Item[] = [
    { type: 'undo' },
    { type: 'redo' },
    ...shownTools.map((s) => ({ type: 'tool' as const, slot: s })),
    ...(others.length ? [{ type: 'more' as const }] : []),
    { type: 'colors' },
  ];
  const c: Point = { x: REACH, y: REACH };
  const angles = fan(direction, items.length, ARC_STEP);

  // What fans out beyond the arc, the same way round as the arc.
  let fanned: React.ReactNode[] | null = null;
  if (page === 'colors' && hasInk(slot.kind)) {
    const colors = [...INK_PALETTE, ...recentColors].slice(0, 11);
    fanned = [
      ...colors.map((color) => (
        <Round
          key={color}
          label={color}
          on={slot.color === color}
          onPress={() => inkDispatch({ type: 'setColor', color })}
          style={{ backgroundColor: onPaper(color) }}
        />
      )),
      <Round
        key='more-colors'
        label='More Colors'
        style={{
          background: 'conic-gradient(#ff3b30, #ffcc00, #34c759, #0a84ff, #af52de, #ff3b30)',
        }}
        onPress={(el) => {
          const { x, y, width, height } = el.getBoundingClientRect();
          void nativeInk.pickColor({ x, y, width, height });
          close();
        }}
      />,
    ];
  } else if (page === 'width' && slot.kind !== 'lasso') {
    const widths = presetWidths(slot.kind);
    const largest = widths[widths.length - 1];
    fanned = widths.map((width) => (
      <Round
        key={width}
        label={`Width ${width}`}
        on={slot.width === width}
        onPress={() => inkDispatch({ type: 'setWidth', width })}
      >
        <span
          className='rounded-full bg-foreground'
          style={{
            width: 4 + (width / largest) * 18,
            height: 4 + (width / largest) * 18,
          }}
        />
      </Round>
    ));
  } else if (page === 'more') {
    fanned = others.map((s) => (
      <Round
        key={s.id}
        label={TOOL_LABELS[s.kind]}
        onPress={() => {
          inkDispatch({ type: 'select', id: s.id });
          close();
        }}
      >
        <SlotFace slot={s} />
      </Round>
    ));
  }
  const fanAngles = fanned ? fan(direction, fanned.length, FAN_STEP) : [];

  return (
    <>
      <Band centre={c} radius={ARC} angles={angles} />
      {/* Keyed apart from the fan's buttons: siblings sharing a key, React can leave one behind. */}
      {fanned && <Band key={`band-${page}`} centre={c} radius={FAN} angles={fanAngles} fade />}

      {items.map((item, i) => (
        <Placed key={item.type === 'tool' ? item.slot.id : item.type} at={polar(c, ARC, angles[i])}>
          {item.type === 'undo' && (
            <Round label='Undo' disabled={!canUndo} onPress={() => void nativeInk.undo()}>
              <Undo2 className='size-5' />
            </Round>
          )}
          {item.type === 'redo' && (
            <Round label='Redo' disabled={!canRedo} onPress={() => void nativeInk.redo()}>
              <Redo2 className='size-5' />
            </Round>
          )}
          {item.type === 'tool' && (
            <Round
              label={TOOL_LABELS[item.slot.kind]}
              on={item.slot.id === slot.id}
              onPress={() => {
                // The tool in hand opens its widths, as Apple's does; another is picked.
                if (item.slot.id === slot.id) return toggle('width', page);
                inkDispatch({ type: 'select', id: item.slot.id });
                close();
              }}
            >
              <SlotFace slot={item.slot} />
            </Round>
          )}
          {item.type === 'colors' && (
            <Round
              label='Color'
              on={page === 'colors'}
              disabled={!hasInk(slot.kind)}
              onPress={() => toggle('colors', page)}
            >
              <span
                className='size-6 rounded-full ring-1 ring-foreground/20'
                style={{
                  backgroundColor: hasInk(slot.kind) ? onPaper(slot.color) : undefined,
                }}
              />
            </Round>
          )}
          {item.type === 'more' && (
            <Round label='More Tools' on={page === 'more'} onPress={() => toggle('more', page)}>
              <Ellipsis className='size-5' />
            </Round>
          )}
        </Placed>
      ))}

      {fanned && (
        <Fanned key={`fan-${page}`}>
          {fanAngles.map((angle, i) => (
            <Placed key={i} at={polar(c, FAN, angle)}>
              {fanned[i]}
            </Placed>
          ))}
        </Fanned>
      )}
    </>
  );
}

/**
 * A rounded band along the circle of `radius`, under buttons at `angles`:
 * translucent and blurred, as the app's menus are, with their hairline rim.
 */
function Band({
  centre,
  radius,
  angles,
  fade,
}: {
  centre: Point;
  radius: number;
  angles: number[];
  /** Fade in when it appears (a fan's; the arc's fades with the palette). */
  fade?: boolean;
}) {
  const blur = useRef<HTMLDivElement>(null);
  const rim = useRef<SVGSVGElement>(null);
  useLayoutEffect(() => {
    if (!fade) return;
    // Each fades itself: never an ancestor of the blur (see `SqueezePalette`).
    for (const el of [blur.current, rim.current]) el?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160 });
  }, [fade]);
  if (!angles.length) return null;
  const d = bandPath(centre, radius, BAND, angles[0], angles[angles.length - 1]);
  return (
    <>
      <div
        ref={blur}
        className='absolute inset-0 bg-popover/70 backdrop-blur-2xl backdrop-saturate-150'
        style={{ clipPath: `path('${d}')` }}
      />
      <svg ref={rim} width={SIZE} height={SIZE} className='absolute inset-0 overflow-visible drop-shadow-lg'>
        <path d={d} fill='none' strokeWidth={1} className='stroke-foreground/10' />
      </svg>
    </>
  );
}

function Placed({ at, children }: { at: Point; children: React.ReactNode }) {
  return (
    <div className='pointer-events-auto absolute -translate-1/2' style={{ left: at.x, top: at.y }}>
      {children}
    </div>
  );
}

/** A fan's buttons, eased out from the arc when it opens. */
function Fanned({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    ref.current?.animate(
      [
        { opacity: 0, scale: 0.85 },
        { opacity: 1, scale: 1 },
      ],
      { duration: 200, easing: SPRING },
    );
  }, []);
  return (
    <div ref={ref} className='pointer-events-none absolute inset-0'>
      {children}
    </div>
  );
}

/** A slot's icon, with its color beneath for an ink. */
function SlotFace({ slot }: { slot: ToolSlot }) {
  const onPaper = usePaperColor();
  return (
    <span className='flex flex-col items-center'>
      <ToolIcon kind={slot.kind} className='size-5' />
      {hasInk(slot.kind) && (
        <span className='mt-0.5 h-1 w-4 rounded-full' style={{ backgroundColor: onPaper(slot.color), opacity: slot.opacity }} />
      )}
    </span>
  );
}

/** A round button that shrinks while it's pressed. */
function Round({
  label,
  on,
  disabled,
  onPress,
  style,
  children,
}: {
  label: string;
  on?: boolean;
  disabled?: boolean;
  onPress: (el: HTMLButtonElement) => void;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}) {
  return (
    <button
      type='button'
      title={label}
      aria-label={label}
      aria-pressed={on}
      disabled={disabled}
      className={cn(
        'grid place-items-center rounded-full text-foreground transition-[scale,background-color] duration-100 ease-out',
        'active:scale-[0.82] disabled:opacity-40 disabled:active:scale-100',
        on ? 'bg-accent ring-2 ring-foreground/40' : 'hover:bg-accent/60',
      )}
      style={{ width: BUTTON - 4, height: BUTTON - 4, ...style }}
      onClick={(event) => onPress(event.currentTarget)}
    >
      {children}
    </button>
  );
}
