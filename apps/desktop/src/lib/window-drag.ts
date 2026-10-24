/**
 * Dragging the window by its title bar while a dialog covers it.
 *
 * Tauri's drag.js only drags when the press lands on a `data-tauri-drag-region`
 * itself, and a modal's overlay takes every press. So a press on an overlay is
 * looked through: if a drag region lies beneath, moving the press drags the
 * window (a double-click maximizes it), and the dialog never hears of that.
 *
 * A press that doesn't move is a click, and left alone: it's a click outside
 * the dialog like any other. The native drag must not start on the press
 * itself. The system's drag loop takes the mouse-up, so the page never hears
 * the button come up, and a click that started one without moving was left
 * held: the dialog and the webview ignored the clicks after it.
 */

const DRAG_REGION = 'data-tauri-drag-region';
/** A dialog's overlay, or Base UI's own invisible backdrop under it. */
const OVERLAY = "[data-slot$='-overlay'], [data-base-ui-inert][role='presentation']";
const CLICKABLE_TAGS = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL', 'SUMMARY']);
const INTERACTIVE_ROLES = new Set(['button', 'link', 'menuitem', 'tab', 'checkbox', 'radio', 'switch', 'option']);

function isClickable(el: Element): boolean {
  const editable = el.getAttribute('contenteditable');
  const tabIndex = el.getAttribute('tabindex');
  return (
    CLICKABLE_TAGS.has(el.tagName) ||
    (editable !== null && editable !== 'false') ||
    (tabIndex !== null && tabIndex !== '-1') ||
    INTERACTIVE_ROLES.has(el.getAttribute('role') ?? '')
  );
}

/** drag.js's rule, for `path` from the element pressed outward. */
export function isDragRegion(path: Element[]): boolean {
  for (const el of path) {
    const attr = el.getAttribute(DRAG_REGION);
    if (isClickable(el) && attr === null) return false;
    if (attr === null) continue;
    if (attr === 'false') return false;
    if (attr === 'deep') return true;
    if (attr === '' || attr === 'true') return el === path[0];
  }
  return false;
}

/**
 * Whether a press on `overlay` would have landed in a drag region without it.
 * `stack` is `elementsFromPoint` at the press: overlays and the overlay's own
 * ancestors (its portal, the body) are skipped to find what's beneath.
 */
export function dragRegionUnder(stack: Element[], overlay: Element): boolean {
  const beneath = stack.find((el) => !el.matches(OVERLAY) && !el.contains(overlay));
  if (!beneath) return false;
  const path: Element[] = [];
  for (let at: Element | null = beneath; at; at = at.parentElement) path.push(at);
  return isDragRegion(path);
}

type DragWindow = { startDragging(): Promise<void>; toggleMaximize(): Promise<void> };

/** How far a press moves before it's a drag and not a click, in px. */
const DRAG_THRESHOLD = 4;

/** Starts looking through overlays for presses on a drag region. Returns the stop. */
export function dragThroughOverlays(currentWindow: () => DragWindow): () => void {
  // A press on an overlay over a drag region, not yet moved far enough to be
  // a drag.
  let pending: { x: number; y: number } | null = null;
  // The click that ends a drag or a double-click: the dialog would read it as
  // a press outside and close. Only ever set while the click can still come.
  let swallowClick = false;

  const onDown = (event: MouseEvent) => {
    pending = null;
    swallowClick = false;
    const target = event.target;
    if (event.button !== 0 || !(target instanceof Element) || !target.matches(OVERLAY)) return;
    if (!dragRegionUnder(document.elementsFromPoint(event.clientX, event.clientY), target)) return;
    if (event.detail === 2) {
      event.preventDefault();
      event.stopPropagation();
      swallowClick = true;
      void currentWindow().toggleMaximize();
      return;
    }
    pending = { x: event.clientX, y: event.clientY };
  };

  const onMove = (event: MouseEvent) => {
    if (!pending) return;
    if ((event.buttons & 1) === 0) {
      pending = null;
      return;
    }
    if (Math.hypot(event.clientX - pending.x, event.clientY - pending.y) < DRAG_THRESHOLD) return;
    pending = null;
    swallowClick = true;
    event.preventDefault();
    event.stopPropagation();
    // The system's drag loop ends with the button's release and keeps it, so
    // when it's over, say so: the page would otherwise go on holding a press,
    // and the next click would be taken for the end of this one.
    void currentWindow()
      .startDragging()
      .catch(() => {})
      .finally(release);
  };

  const release = () => {
    swallowClick = false;
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerType: 'mouse' }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
  };

  const onUp = () => {
    pending = null;
  };

  const onClick = (event: MouseEvent) => {
    if (!swallowClick) return;
    swallowClick = false;
    event.preventDefault();
    event.stopPropagation();
  };

  window.addEventListener('mousedown', onDown, true);
  window.addEventListener('mousemove', onMove, true);
  window.addEventListener('mouseup', onUp, true);
  window.addEventListener('click', onClick, true);
  return () => {
    window.removeEventListener('mousedown', onDown, true);
    window.removeEventListener('mousemove', onMove, true);
    window.removeEventListener('mouseup', onUp, true);
    window.removeEventListener('click', onClick, true);
  };
}
