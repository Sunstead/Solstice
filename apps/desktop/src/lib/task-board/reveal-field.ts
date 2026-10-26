/**
 * Scrolls a column's list to show the field being typed in, as it grows or
 * the keyboard comes up. Only the list: the system's own scrolling to a
 * focused field would move the whole page, which the app keeps still.
 */
export function revealField(field: Element | null) {
  const list = field?.closest<HTMLElement>('[data-column-scroll]');
  if (!field || !list || !field.matches('input, textarea')) return;
  const at = field.getBoundingClientRect();
  const view = list.getBoundingClientRect();
  const margin = 8;
  if (at.bottom > view.bottom - margin) list.scrollTop += at.bottom - view.bottom + margin;
  else if (at.top < view.top + margin) list.scrollTop -= view.top - at.top + margin;
}
