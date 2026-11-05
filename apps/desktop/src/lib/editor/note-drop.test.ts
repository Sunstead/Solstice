// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  window.matchMedia ??= ((query: string) => ({
    matches: query === '(any-pointer: fine)',
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

import { dropIntoNoteAt, entryLink, registerNoteDrop } from './note-drop';

const index = { byPath: new Map(), byName: new Map([['b', ['a/b.md', 'c/b.md']]]) } as never;

describe('entryLink', () => {
  it('links a note by its shortest target', () => {
    expect(entryLink({ path: '/w/notes/plan.md', name: 'plan.md', is_dir: false }, '/w', index)).toEqual({ embed: false, target: 'plan' });
  });
  it('keeps the folder where the name alone is ambiguous', () => {
    expect(entryLink({ path: '/w/a/b.md', name: 'b.md', is_dir: false }, '/w', index)).toEqual({ embed: false, target: 'a/b' });
  });
  it('embeds an image', () => {
    expect(entryLink({ path: '/w/cat.png', name: 'cat.png', is_dir: false }, '/w', index).embed).toBe(true);
  });
});

describe('dropIntoNoteAt', () => {
  const payload = { files: [], entry: null, x: 5, y: 5 };
  let note: HTMLElement;
  let overlay: HTMLElement;

  beforeEach(() => {
    note = document.createElement('div');
    note.className = 'ProseMirror';
    overlay = document.createElement('div');
    document.body.append(note, overlay);
  });
  afterEach(() => {
    note.remove();
    overlay.remove();
  });

  it('finds the note under the layout’s overlay and hands it the drop', () => {
    const inner = document.createElement('p');
    note.append(inner);
    document.elementsFromPoint = () => [overlay, inner, note];
    const take = vi.fn(() => true);
    registerNoteDrop(note, take);
    expect(dropIntoNoteAt(payload)).toBe(true);
    expect(take).toHaveBeenCalledWith(payload);
  });

  it('declines where there’s no note under the pointer', () => {
    document.elementsFromPoint = () => [overlay];
    expect(dropIntoNoteAt(payload)).toBe(false);
  });
});
