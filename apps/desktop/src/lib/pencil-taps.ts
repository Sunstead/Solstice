import { nativePencilTaps } from '@/lib/backend/native';

/**
 * Taps the page with the Pencil taps WebKit missed (`PencilTaps.swift`), so
 * a burst on Undo undoes once per tap.
 */
export function followPencilTaps(): () => void {
  let cancelled = false;
  let stop: (() => void) | undefined;
  void nativePencilTaps
    .listen(({ x, y }) => tapAt(x, y))
    .then((listener) => {
      if (cancelled) void listener.unregister();
      else stop = () => void listener.unregister();
    });
  return () => {
    cancelled = true;
    stop?.();
  };
}

/**
 * What a Pencil tap at (`x`, `y`) sends, in CSS pixels: pointer down and up,
 * then mouse down, up and a click, as WebKit does. Not into text, where a
 * tap is Scribble's to place the caret.
 */
export function tapAt(x: number, y: number) {
  const target = document.elementFromPoint(x, y);
  if (!target || isText(target)) return;
  const at = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0 };
  const pen = { ...at, pointerId: 2, pointerType: 'pen', isPrimary: true };
  const down = target.dispatchEvent(new PointerEvent('pointerdown', { ...pen, buttons: 1, pressure: 0.5 }));
  target.dispatchEvent(new PointerEvent('pointerup', { ...pen, buttons: 0 }));
  // A cancelled pointerdown holds the mouse events back, but not the click.
  if (down) {
    target.dispatchEvent(new MouseEvent('mousedown', { ...at, buttons: 1, detail: 1 }));
    target.dispatchEvent(new MouseEvent('mouseup', { ...at, detail: 1 }));
  }
  target.dispatchEvent(new MouseEvent('click', { ...at, detail: 1 }));
}

function isText(el: Element): boolean {
  return (el instanceof HTMLElement && el.isContentEditable) || !!el.closest('input, textarea, select');
}
