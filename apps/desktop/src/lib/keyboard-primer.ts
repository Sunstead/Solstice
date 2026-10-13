import { touchFirst } from '@/lib/backend/platform';

let field: HTMLInputElement | null = null;
let release = 0;

/**
 * Raises the on-screen keyboard now, for a text field that's about to appear.
 *
 * iOS only shows the keyboard for a field focused during a tap. A naming
 * dialog's field mounts after the tap (a menu closing first, a reveal in the
 * explorer awaited), so focusing it raised nothing. Call this in the tap's
 * handler: it focuses a hidden field at once, which brings the keyboard up,
 * and the real field then takes focus from it, keeping the keyboard up.
 * Nothing on a computer.
 */
export function primeKeyboard(): void {
  if (!touchFirst || typeof document === 'undefined') return;
  if (!field || !field.isConnected) {
    field = document.createElement('input');
    field.type = 'text';
    field.tabIndex = -1;
    field.autocomplete = 'off';
    field.setAttribute('aria-hidden', 'true');
    // 16px, or iOS zooms the page to it. Inside #root: anything else under
    // <body> reads as an open dialog to the native views (native-surfaces).
    Object.assign(field.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '1px',
      height: '1px',
      padding: '0',
      border: '0',
      opacity: '0',
      fontSize: '16px',
      pointerEvents: 'none',
    });
    (document.getElementById('root') ?? document.body).appendChild(field);
  }
  field.focus({ preventScroll: true });
  // If no field takes over (the dialog never opened), let the keyboard go.
  clearTimeout(release);
  release = window.setTimeout(() => {
    if (document.activeElement === field) field?.blur();
  }, 2000);
}
