/**
 * Dragging the window by its title bar while a dialog covers it.
 *
 * Tauri's drag.js only drags when the press lands on a `data-tauri-drag-region`
 * itself, and a modal's overlay takes every press. So a press on an overlay is
 * looked through: if a drag region lies beneath, it drags (or maximizes on a
 * double-click) the window instead, and the dialog never hears of it.
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

/** Starts looking through overlays for presses on a drag region. Returns the stop. */
export function dragThroughOverlays(currentWindow: () => DragWindow): () => void {
  // The click that ends a press taken for a drag: the dialog would read it as
  // a press outside and close.
  let swallowClick = false;

  const onDown = (event: MouseEvent) => {
    swallowClick = false;
    const target = event.target;
    if (event.button !== 0 || !(target instanceof Element) || !target.matches(OVERLAY)) return;
    if (!dragRegionUnder(document.elementsFromPoint(event.clientX, event.clientY), target)) return;
    event.preventDefault();
    event.stopPropagation();
    swallowClick = true;
    const win = currentWindow();
    void (event.detail === 2 ? win.toggleMaximize() : win.startDragging());
  };

  const onClick = (event: MouseEvent) => {
    if (!swallowClick) return;
    swallowClick = false;
    event.preventDefault();
    event.stopPropagation();
  };

  window.addEventListener('mousedown', onDown, true);
  window.addEventListener('click', onClick, true);
  return () => {
    window.removeEventListener('mousedown', onDown, true);
    window.removeEventListener('click', onClick, true);
  };
}
