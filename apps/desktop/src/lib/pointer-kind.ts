/**
 * Marks `<html>` with the kind of pointer last used: `data-pointer` is
 * `touch`, `pen` or `mouse` (a trackpad too).
 *
 * Hover styles key off it (the `hover` variant in `styles/app.css`). The
 * media query Tailwind uses, `(hover: hover)`, is false on an iPad, since
 * its main pointer is a finger, so nothing hovered there, not even under
 * the Apple Pencil, which does hover. Asking which pointer is in use gives
 * the Pencil and a trackpad their hover, and keeps a finger's tap from
 * leaving a highlight stuck behind it.
 */
export function trackPointerKind(): void {
  if (typeof window === 'undefined') return;
  const root = document.documentElement;
  const note = (event: PointerEvent) => {
    const kind = event.pointerType === 'touch' || event.pointerType === 'pen' ? event.pointerType : 'mouse';
    if (root.dataset.pointer !== kind) root.dataset.pointer = kind;
  };
  // `pointerover` comes before the `:hover` it causes, and the Pencil
  // hovering over the screen sends it without touching.
  for (const type of ['pointerover', 'pointerdown', 'pointermove'] as const) {
    window.addEventListener(type, note, { capture: true, passive: true });
  }
}
