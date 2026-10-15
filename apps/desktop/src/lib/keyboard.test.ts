// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  // jsdom has no matchMedia; keyboard.ts reads it as it loads.
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});
vi.mock('@/lib/backend/native', () => ({ nativeKeyboard: { listen: vi.fn() } }));
vi.mock('@/lib/backend/platform', () => ({ can: { nativeViews: false } }));

import {
  caretOverlap,
  editableElement,
  keyboardBarShown,
  keyboardRoom,
  placeAboveKeyboard,
  shouldRefocus,
  KEYBOARD_BAR_GAP_PX,
  KEYBOARD_BAR_PX,
} from './keyboard';

describe('keyboardRoom', () => {
  const pane = { bottom: 1000 };
  const base = { rect: pane, viewportHeight: 1000, inset: 0, docked: false, bar: false };

  it('makes room for a docked keyboard where it covers the pane, and the bar on it', () => {
    expect(keyboardRoom({ ...base, inset: 400, docked: true })).toBe('400px');
    expect(keyboardRoom({ ...base, inset: 400, docked: true, bar: true })).toBe(`${400 + KEYBOARD_BAR_PX}px`);
    // A pane that ends above the keyboard: only the bar.
    expect(keyboardRoom({ ...base, rect: { bottom: 500 }, inset: 400, docked: true, bar: true })).toBe(
      `${KEYBOARD_BAR_PX}px`,
    );
  });

  it('makes room for the bar at the foot of the pane', () => {
    expect(keyboardRoom({ ...base, bar: true })).toBe(
      `calc(${KEYBOARD_BAR_PX + KEYBOARD_BAR_GAP_PX}px + max(0px, env(safe-area-inset-bottom) - 0px))`,
    );
  });

  it('needs none with no keyboard and no bar (a hardware keyboard)', () => {
    expect(keyboardRoom(base)).toBeUndefined();
  });
});

describe('keyboardBarShown', () => {
  it('shows for a note on a touch screen, unless a hardware keyboard types', () => {
    expect(keyboardBarShown({ touch: true, note: true, hardware: false })).toBe(true);
    expect(keyboardBarShown({ touch: true, note: true, hardware: true })).toBe(false);
    expect(keyboardBarShown({ touch: false, note: true, hardware: false })).toBe(false);
    expect(keyboardBarShown({ touch: true, note: false, hardware: false })).toBe(false);
  });
});

describe('placeAboveKeyboard', () => {
  const viewport = { width: 1000, height: 1000 };
  const size = { width: 300, height: 200 };

  it('opens on its side of the anchor when there is room', () => {
    const anchor = { top: 300, bottom: 320, left: 50 };
    expect(placeAboveKeyboard(anchor, size, viewport, 0)).toEqual({ top: 326, left: 50 });
    expect(placeAboveKeyboard(anchor, size, viewport, 0, 'above')).toEqual({ top: 94, left: 50 });
  });

  it('flips above its anchor when the keyboard would cover it', () => {
    const anchor = { top: 500, bottom: 520, left: 50 };
    expect(placeAboveKeyboard(anchor, size, viewport, 400)).toEqual({ top: 294, left: 50 });
  });

  it('flips below when there is no room above', () => {
    const anchor = { top: 100, bottom: 120, left: 50 };
    expect(placeAboveKeyboard(anchor, size, viewport, 0, 'above')).toEqual({ top: 126, left: 50 });
  });

  it('stays on screen, above the keyboard, when it fits neither way', () => {
    const anchor = { top: 150, bottom: 170, left: 900 };
    const placed = placeAboveKeyboard(anchor, size, viewport, 700);
    expect(placed.top + size.height).toBeLessThanOrEqual(1000 - 700);
    expect(placed.top).toBeGreaterThanOrEqual(0);
    expect(placed.left + size.width).toBeLessThanOrEqual(1000);
  });
});

describe('caretOverlap', () => {
  it('is how far the caret (and a line under it) reaches behind a docked keyboard and its bar', () => {
    const base = { viewportHeight: 1000, inset: 400, bar: false };
    expect(caretOverlap({ ...base, caretBottom: 500 })).toBe(0);
    expect(caretOverlap({ ...base, caretBottom: 700 })).toBe(700 + 32 - 600);
    expect(caretOverlap({ ...base, caretBottom: 700, bar: true })).toBe(700 + 32 - 600 + KEYBOARD_BAR_PX);
  });
});

describe('shouldRefocus', () => {
  let editor: HTMLElement;
  let inside: HTMLElement;
  beforeEach(() => {
    editor = document.createElement('div');
    editor.contentEditable = 'true';
    inside = document.createElement('p');
    editor.append(inside);
    document.body.append(editor);
  });
  afterEach(() => editor.remove());

  const tap = { touch: true, docked: false, hardware: false };

  it('refocuses a finger tap in the focused text with no keyboard up (after Scribble)', () => {
    expect(shouldRefocus({ ...tap, focused: editor, target: inside })).toBe(true);
  });

  it('leaves it be with a keyboard up, a hardware keyboard, the Pencil, or a tap elsewhere', () => {
    expect(shouldRefocus({ ...tap, docked: true, focused: editor, target: inside })).toBe(false);
    expect(shouldRefocus({ ...tap, hardware: true, focused: editor, target: inside })).toBe(false);
    expect(shouldRefocus({ ...tap, touch: false, focused: editor, target: inside })).toBe(false);
    expect(shouldRefocus({ ...tap, focused: editor, target: document.body })).toBe(false);
    expect(shouldRefocus({ ...tap, focused: null, target: inside })).toBe(false);
  });
});

describe('editableElement', () => {
  it('is the focused field or editor, not the page', () => {
    const input = document.createElement('input');
    const button = document.createElement('button');
    document.body.append(input, button);
    expect(editableElement(input)).toBe(input);
    expect(editableElement(button)).toBeNull();
    expect(editableElement(document.body)).toBeNull();
    expect(editableElement(null)).toBeNull();
    input.remove();
    button.remove();
  });
});
