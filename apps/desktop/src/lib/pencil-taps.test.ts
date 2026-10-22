// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/backend/native', () => ({ nativePencilTaps: { listen: vi.fn() } }));

import { tapAt } from './pencil-taps';

const TYPES = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click'];

/** `el` under every point, and what reaches it. */
function under(el: Element) {
  document.elementFromPoint = () => el;
  const seen: string[] = [];
  for (const type of TYPES) el.addEventListener(type, (e) => seen.push(`${type}:${(e as PointerEvent).pointerType ?? ''}`));
  return seen;
}

describe('tapAt', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('sends what a Pencil tap does, in order', () => {
    const button = document.body.appendChild(document.createElement('button'));
    const seen = under(button);
    const click = vi.fn();
    button.addEventListener('click', click);
    tapAt(10, 20);
    expect(seen).toEqual(['pointerdown:pen', 'pointerup:pen', 'mousedown:', 'mouseup:', 'click:']);
    expect(click.mock.calls[0][0]).toMatchObject({ clientX: 10, clientY: 20, bubbles: true });
  });

  it('holds the mouse events back, not the click, when pointerdown is cancelled', () => {
    const button = document.body.appendChild(document.createElement('button'));
    const seen = under(button);
    button.addEventListener('pointerdown', (e) => e.preventDefault());
    tapAt(0, 0);
    expect(seen).toEqual(['pointerdown:pen', 'pointerup:pen', 'click:']);
  });

  it.each([
    ['an input', '<input>'],
    ['a text area', '<textarea></textarea>'],
    ['editable text', '<div contenteditable="true"><p>note</p></div>'],
  ])('leaves %s to Scribble', (_, html) => {
    document.body.innerHTML = html;
    const el = document.body.querySelector('p') ?? document.body.firstElementChild!;
    // jsdom has no layout, so no isContentEditable either.
    Object.defineProperty(el, 'isContentEditable', { value: html.includes('contenteditable') });
    const seen = under(el);
    tapAt(0, 0);
    expect(seen).toEqual([]);
  });
});
