/**
 * Reading the DOM behind an editor event.
 *
 * `event.target` is whatever node the browser hit, which for text is a text
 * node rather than an element -- so every `handleDOMEvents` handler that wants
 * to know what was clicked has to step up to the nearest element first.
 */

export function elementFromEvent(event: Event): HTMLElement | null {
  const node = event.target as Node | null;
  return node instanceof HTMLElement ? node : (node?.parentElement ?? null);
}

/** The nearest element matching `selector` at or above the event's target. */
export function closestFromEvent(
  event: Event,
  selector: string,
): HTMLElement | null {
  return elementFromEvent(event)?.closest<HTMLElement>(selector) ?? null;
}

/** `attribute` on the nearest element matching `selector`, if any. */
export function attributeFromEvent(
  event: Event,
  selector: string,
  attribute: string,
): string | null {
  return closestFromEvent(event, selector)?.getAttribute(attribute) ?? null;
}
