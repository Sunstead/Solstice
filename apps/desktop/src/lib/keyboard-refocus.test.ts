// @vitest-environment jsdom
import { createElement as h, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  // A touch screen: keyboard.ts reads this as it loads.
  window.matchMedia = ((query: string) => ({
    matches: query === '(pointer: coarse)',
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
const { expectTyping } = vi.hoisted(() => ({ expectTyping: vi.fn() }));
vi.mock('@/lib/backend/native', () => ({ nativeKeyboard: { listen: vi.fn(), expectTyping } }));
vi.mock('@/lib/backend/platform', () => ({ can: { nativeViews: true } }));

import { useEditingFocusTracking, useKeyboard, useKeyboardDismissal, useKeyboardRefocus } from './keyboard';

// After Scribble, iOS keeps the text focused with no keyboard, and a tap on
// focused text starts nothing new. Letting go of focus as the finger lands
// makes the tap focus it afresh, which raises the keyboard.
describe('a finger landing in focused text', () => {
  let root: Root;
  let host: HTMLDivElement;
  let editor: HTMLDivElement;
  let line: HTMLParagraphElement;

  function Hooks() {
    useEditingFocusTracking();
    useKeyboardRefocus();
    useKeyboardDismissal();
    return null;
  }

  beforeEach(() => {
    host = document.createElement('div');
    editor = document.createElement('div');
    editor.contentEditable = 'true';
    // jsdom has no isContentEditable.
    Object.defineProperty(editor, 'isContentEditable', { value: true });
    editor.tabIndex = 0;
    line = document.createElement('p');
    editor.append(line);
    document.body.append(host, editor);
    root = createRoot(host);
    act(() => root.render(h(Hooks)));
    editor.focus();
    useKeyboard.setState({ shown: false, hardware: false, dismissed: false });
    expectTyping.mockClear();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    editor.remove();
  });

  const land = (pointerType: string) =>
    line.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType }));

  it('lets go of focus when no keyboard is up, so the tap focuses it afresh', () => {
    expect(document.activeElement).toBe(editor);
    land('touch');
    expect(document.activeElement).not.toBe(editor);
  });

  // iOS keeps expecting the Pencil for some seconds after Scribble, and
  // keeps the keyboard down meanwhile, focus or not.
  it('tells iOS a finger is typing now, not the Pencil', () => {
    land('touch');
    expect(expectTyping).toHaveBeenCalledTimes(1);
  });

  it('keeps focus with a keyboard shown', () => {
    useKeyboard.setState({ shown: true });
    land('touch');
    expect(document.activeElement).toBe(editor);
    expect(expectTyping).not.toHaveBeenCalled();
  });

  it('keeps focus for the Pencil, which Scribble writes with', () => {
    land('pen');
    expect(document.activeElement).toBe(editor);
  });
});

// The keyboard's own hide button leaves the note focused: the keyboard bar
// goes with the keyboard all the same.
describe('putting the keyboard away', () => {
  let root: Root;
  let host: HTMLDivElement;
  let editor: HTMLDivElement;
  let line: HTMLParagraphElement;

  function Hooks() {
    useEditingFocusTracking();
    useKeyboardDismissal();
    return null;
  }

  beforeEach(() => {
    host = document.createElement('div');
    editor = document.createElement('div');
    editor.contentEditable = 'true';
    Object.defineProperty(editor, 'isContentEditable', { value: true });
    editor.tabIndex = 0;
    line = document.createElement('p');
    editor.append(line);
    document.body.append(host, editor);
    root = createRoot(host);
    act(() => root.render(h(Hooks)));
    useKeyboard.setState({ shown: false, dismissed: false });
    editor.focus();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    editor.remove();
  });

  const dismissed = () => useKeyboard.getState().dismissed;
  const keyboard = (shown: boolean) => act(() => useKeyboard.setState({ shown }));

  it('is the keyboard going while the note keeps focus', () => {
    keyboard(true);
    expect(dismissed()).toBe(false);
    keyboard(false);
    expect(dismissed()).toBe(true);
  });

  it('ends when the keyboard comes back', () => {
    keyboard(true);
    keyboard(false);
    keyboard(true);
    expect(dismissed()).toBe(false);
  });

  it('ends when the Pencil writes in the note', () => {
    keyboard(true);
    keyboard(false);
    line.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'pen' }));
    expect(dismissed()).toBe(false);
  });

  it('ends when focus moves', () => {
    keyboard(true);
    keyboard(false);
    act(() => editor.blur());
    expect(dismissed()).toBe(false);
  });

  it("isn't Scribble, where no keyboard came up", () => {
    line.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'pen' }));
    keyboard(false);
    expect(dismissed()).toBe(false);
  });
});
