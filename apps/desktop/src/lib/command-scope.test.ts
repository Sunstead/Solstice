// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { commandScope, findConflicts, pickCommand } from '@/lib/command-scope';
import { toTinykeysFormat } from '@/lib/accelerator';

function board(inner = '') {
  const root = document.createElement('div');
  root.innerHTML = `<div data-canvas-board tabindex="0">${inner}</div><p contenteditable="true">note</p>`;
  document.body.replaceChildren(root);
  return root;
}

describe('canvas keys', () => {
  const slot = { global: 'file.new_note', canvas: 'canvas.new_text' };

  it('scopes commands by family', () => {
    expect(commandScope('canvas.new_group')).toBe('canvas');
    expect(commandScope('edit.bold')).toBe('global');
  });

  it('runs the canvas command on the board itself', () => {
    const root = board();
    expect(pickCommand(slot, root.querySelector('[data-canvas-board]'))).toBe('canvas.new_text');
  });

  it('falls back to the global command in a card editor or a note', () => {
    const root = board('<div data-canvas-editing><div contenteditable="true">card</div></div>');
    expect(pickCommand(slot, root.querySelector('[data-canvas-editing] [contenteditable]'))).toBe('file.new_note');
    expect(pickCommand(slot, root.querySelector('p'))).toBe('file.new_note');
  });

  it('leaves a canvas-only key alone off the board, so it types', () => {
    const root = board();
    expect(pickCommand({ canvas: 'canvas.new_text' }, root.querySelector('p'))).toBeUndefined();
  });
});

describe('toTinykeysFormat', () => {
  it('writes digits and punctuation as codes, which survive Shift', () => {
    expect(toTinykeysFormat('Shift+1')).toBe('Shift+Digit1');
    expect(toTinykeysFormat("CmdOrCtrl+'")).toBe('$mod+Quote');
    expect(toTinykeysFormat('CmdOrCtrl+,')).toBe('$mod+Comma');
    expect(toTinykeysFormat('CmdOrCtrl+Shift+B')).toBe('$mod+Shift+b');
    expect(toTinykeysFormat('Alt+ArrowLeft')).toBe('Alt+ArrowLeft');
  });
});

describe('findConflicts', () => {
  it('lets a canvas key share a global one, but not another canvas key', () => {
    const conflicts = findConflicts(
      [
        { id: 'file.new_note', label: 'New Note', accelerator: 'N' },
        { id: 'canvas.new_text', label: 'New Card', accelerator: 'N' },
        { id: 'canvas.toggle_minimap', label: 'Show Minimap', accelerator: 'N' },
      ] as Parameters<typeof findConflicts>[0],
      new Map(),
    );
    expect(conflicts.get('file.new_note')).toBeUndefined();
    expect(conflicts.get('canvas.new_text')).toBe('Show Minimap');
  });
});
