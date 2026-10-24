import { overSurfaceMoved } from '@/lib/native-surfaces';
import {
  cornerAt,
  nearestCorner,
  rubberBand,
  springKeyframes,
  velocityOf,
  type Area,
  type Corner,
  type Point,
} from './badge-motion';

/** Movement before a press is a drag rather than a tap: UIKit's slop. */
const SLOP = 10;
/** How much the badge grows while held, as a lifted item does on iPadOS. */
const LIFT_SCALE = 1.1;

export interface BadgeGesture {
  /** Puts it in `corner` at once, unless it's held or already on its way there. */
  place: (corner: Corner) => void;
  destroy: () => void;
}

/**
 * Drags the tool badge with a finger, the Pencil or a mouse, and throws it
 * to a corner on letting go (`badge-motion.ts`). Its position is its
 * `translate` in `area()`; a tap (or a click from the keyboard) is
 * `onTap`. Grabbing it mid-flight catches it where it is.
 */
export function createBadgeGesture(
  el: HTMLElement,
  area: () => Area,
  { onTap, onThrow }: { onTap: () => void; onThrow: (corner: Corner) => void },
): BadgeGesture {
  let press: { id: number; x: number; y: number; at: Point; caught: boolean } | null = null;
  let samples: (Point & { t: number })[] = [];
  let dragging = false;
  // A drag ends in a click too; that one isn't a tap.
  let dragged = false;
  let motion: Animation | null = null;
  let target: Corner | null = null;
  let lift: Animation | null = null;

  const position = (): Point => {
    const [x = 0, y = 0] = getComputedStyle(el).translate.split(' ').map((v) => parseFloat(v) || 0);
    return { x, y };
  };
  const setPosition = ({ x, y }: Point) => {
    el.style.translate = `${x}px ${y}px`;
  };

  const setLifted = (on: boolean) => {
    const from = getComputedStyle(el).scale;
    lift?.cancel();
    const to = on ? String(LIFT_SCALE) : '1';
    el.style.scale = to;
    el.toggleAttribute('data-lifted', on);
    lift = el.animate([{ scale: from === 'none' ? '1' : from }, { scale: to }], {
      duration: on ? 160 : 320,
      // Out with a touch of bounce, as the snap has.
      easing: on ? 'cubic-bezier(0.2, 0, 0, 1)' : 'cubic-bezier(0.3, 1.4, 0.5, 1)',
    });
  };

  const throwTo = (corner: Corner, velocity: Point) => {
    const from = position();
    const box = area();
    const to = cornerAt(corner, box);
    const max = { x: Math.max(0, box.width - box.size), y: Math.max(0, box.height - box.size) };
    const { frames, duration } = springKeyframes(from, to, velocity, { max, give: box.size });
    motion?.cancel();
    setPosition(to);
    target = corner;
    const running = el.animate(
      frames.map(({ x, y }) => ({ translate: `${x}px ${y}px` })),
      { duration, easing: 'linear' },
    );
    motion = running;
    // The area may have changed size on the way.
    running.onfinish = () => {
      if (motion !== running) return;
      motion = null;
      place(corner);
    };
    overSurfaceMoved();
  };

  const place = (corner: Corner) => {
    if (dragging || (motion && target === corner)) return;
    motion?.cancel();
    motion = null;
    target = corner;
    setPosition(cornerAt(corner, area()));
    overSurfaceMoved();
  };

  const onDown = (e: PointerEvent) => {
    if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    el.setPointerCapture(e.pointerId);
    // Caught mid-flight: it stops where it is, as it would on iOS.
    const caught = motion !== null;
    const at = position();
    motion?.cancel();
    motion = null;
    setPosition(at);
    press = { id: e.pointerId, x: e.clientX, y: e.clientY, at, caught };
    samples = [{ ...at, t: e.timeStamp }];
    dragged = false;
    if (caught) {
      dragging = true;
      setLifted(true);
    }
  };

  const onMove = (e: PointerEvent) => {
    if (!press || e.pointerId !== press.id) return;
    const dx = e.clientX - press.x;
    const dy = e.clientY - press.y;
    if (!dragging) {
      if (Math.hypot(dx, dy) < SLOP) return;
      dragging = true;
      setLifted(true);
    }
    e.preventDefault();
    const { width, height, size } = area();
    const raw = { x: press.at.x + dx, y: press.at.y + dy };
    setPosition({
      x: rubberBand(raw.x, 0, Math.max(0, width - size), width),
      y: rubberBand(raw.y, 0, Math.max(0, height - size), height),
    });
    samples.push({ ...raw, t: e.timeStamp });
    if (samples.length > 20) samples.shift();
    overSurfaceMoved();
  };

  const onUp = (e: PointerEvent, cancelled: boolean) => {
    if (!press || e.pointerId !== press.id) return;
    const wasDragging = dragging;
    press = null;
    dragging = false;
    if (!wasDragging) return;
    dragged = true;
    setLifted(false);
    const velocity = cancelled ? { x: 0, y: 0 } : velocityOf(samples);
    const corner = nearestCorner(position(), velocity, area());
    throwTo(corner, velocity);
    onThrow(corner);
  };

  const onClick = (e: MouseEvent) => {
    if (dragged) {
      dragged = false;
      e.preventDefault();
      return;
    }
    onTap();
  };

  const up = (e: PointerEvent) => onUp(e, false);
  const cancel = (e: PointerEvent) => onUp(e, true);
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('click', onClick);

  return {
    place,
    destroy: () => {
      motion?.cancel();
      lift?.cancel();
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
      el.removeEventListener('click', onClick);
    },
  };
}
