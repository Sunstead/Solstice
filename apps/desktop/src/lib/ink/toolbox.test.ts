import { describe, expect, it } from 'vitest';

import {
  INK_PALETTE,
  badgeLook,
  TOOL_KINDS,
  MAX_RECENT_COLORS,
  MAX_RECENT_TOOLS,
  defaultToolbox,
  pencilAction,
  presetWidths,
  sanitize,
  selectedSlot,
  toNative,
  toolbox,
  type Toolbox,
} from './toolbox';

const start = () => defaultToolbox();
const idOf = (state: Toolbox, kind: string) => state.slots.find((s) => s.kind === kind)!.id;

describe('defaultToolbox', () => {
  it("starts with Apple's set, the pen in hand", () => {
    const state = start();
    expect(state.slots.map((s) => s.kind)).toEqual([
      'pen',
      'monoline',
      'fountainPen',
      'marker',
      'pencil',
      'crayon',
      'watercolor',
      'eraser',
      'lasso',
    ]);
    expect(selectedSlot(state).kind).toBe('pen');
    expect(new Set(state.slots.map((s) => s.id)).size).toBe(state.slots.length);
    expect(state.ruler).toBe(false);
    expect(state.fingerDraws).toBe(false);
  });
});

describe('select', () => {
  it('remembers the tool before and puts the new one first in recents', () => {
    const before = start();
    const pencil = idOf(before, 'pencil');
    const after = toolbox(before, { type: 'select', id: pencil });
    expect(after.selected).toBe(pencil);
    expect(after.previous).toBe(before.selected);
    expect(after.recents[0]).toBe(pencil);
  });

  it('ignores an id it does not have, and reselecting changes nothing', () => {
    const state = start();
    expect(toolbox(state, { type: 'select', id: 'nope' })).toBe(state);
    expect(toolbox(state, { type: 'select', id: state.selected })).toBe(state);
  });

  it('keeps recents unique and capped', () => {
    let state = start();
    for (const slot of [...state.slots, ...state.slots]) state = toolbox(state, { type: 'select', id: slot.id });
    expect(state.recents.length).toBe(MAX_RECENT_TOOLS);
    expect(new Set(state.recents).size).toBe(state.recents.length);
    expect(state.recents[0]).toBe(state.slots.slice(-1)[0]!.id);
  });
});

describe('selectPrevious and toggleEraser', () => {
  it('swaps back and forth with the tool before', () => {
    const marker = idOf(start(), 'marker');
    const a = toolbox(start(), { type: 'select', id: marker });
    const b = toolbox(a, { type: 'selectPrevious' });
    expect(selectedSlot(b).kind).toBe('pen');
    expect(selectedSlot(toolbox(b, { type: 'selectPrevious' })).id).toBe(marker);
  });

  it('goes to the eraser and back, as a double tap does', () => {
    const marker = idOf(start(), 'marker');
    const holding = toolbox(start(), { type: 'select', id: marker });
    const erasing = toolbox(holding, { type: 'toggleEraser' });
    expect(selectedSlot(erasing).kind).toBe('eraser');
    expect(selectedSlot(toolbox(erasing, { type: 'toggleEraser' })).id).toBe(marker);
  });

  it('does nothing with no eraser to go to', () => {
    let state = start();
    state = toolbox(state, { type: 'remove', id: idOf(state, 'eraser') });
    expect(toolbox(state, { type: 'toggleEraser' })).toBe(state);
  });
});

describe('colour, width and opacity', () => {
  it('colours the tool in hand and keeps custom colours as recents', () => {
    let state = toolbox(start(), { type: 'setColor', color: '#123456' });
    expect(selectedSlot(state).color).toBe('#123456');
    expect(state.recentColors).toEqual(['#123456']);
    state = toolbox(state, { type: 'setColor', color: '#ABCDEF' });
    state = toolbox(state, { type: 'setColor', color: '#123456' });
    expect(state.recentColors).toEqual(['#123456', '#abcdef']);
  });

  it('keeps no recent while the picker is still moving', () => {
    const state = toolbox(start(), { type: 'setColor', color: '#123456', recent: false });
    expect(selectedSlot(state).color).toBe('#123456');
    expect(state.recentColors).toEqual([]);
  });

  it('leaves palette colours out of recents, and caps them', () => {
    let state = toolbox(start(), { type: 'setColor', color: INK_PALETTE[1] });
    expect(state.recentColors).toEqual([]);
    for (let i = 0; i < MAX_RECENT_COLORS + 3; i++) {
      state = toolbox(state, { type: 'setColor', color: `#0000${(16 + i).toString(16)}` });
    }
    expect(state.recentColors.length).toBe(MAX_RECENT_COLORS);
  });

  it('refuses a colour that is not #rrggbb, and colours nothing without ink', () => {
    const state = start();
    expect(toolbox(state, { type: 'setColor', color: 'red' })).toBe(state);
    const erasing = toolbox(state, { type: 'select', id: idOf(state, 'eraser') });
    expect(toolbox(erasing, { type: 'setColor', color: '#123456' })).toBe(erasing);
  });

  it('offers six widths per tool, thin to thick, the thinnest finer than a hairline pen', () => {
    for (const kind of TOOL_KINDS.filter((k) => k !== 'lasso')) {
      const widths = presetWidths(kind);
      expect(widths).toHaveLength(6);
      widths.forEach((w, i) => i > 0 && expect(w).toBeGreaterThan(widths[i - 1]));
    }
    expect(presetWidths('pen')[0]).toBeLessThan(1.5);
  });

  it('starts each tool on a middle width', () => {
    expect(selectedSlot(start()).width).toBe(5);
  });

  it("snaps a width to the tool's presets", () => {
    const presets = presetWidths('pen');
    const state = toolbox(start(), { type: 'setWidth', width: presets[3] + 0.1 });
    expect(selectedSlot(state).width).toBe(presets[3]);
    expect(selectedSlot(toolbox(start(), { type: 'setWidth', width: 999 })).width).toBe(presets.slice(-1)[0]);
  });

  it('keeps opacity within 0.1 and 1', () => {
    expect(selectedSlot(toolbox(start(), { type: 'setOpacity', opacity: 0 })).opacity).toBe(0.1);
    expect(selectedSlot(toolbox(start(), { type: 'setOpacity', opacity: 4 })).opacity).toBe(1);
    expect(selectedSlot(toolbox(start(), { type: 'setOpacity', opacity: 0.5 })).opacity).toBe(0.5);
  });

  it('switches an eraser between vector and bitmap', () => {
    const state = toolbox(start(), { type: 'select', id: idOf(start(), 'eraser') });
    expect(selectedSlot(state).eraser).toBe('vector');
    expect(selectedSlot(toolbox(state, { type: 'setEraserMode', mode: 'bitmap' })).eraser).toBe('bitmap');
  });
});

describe('slots', () => {
  it('duplicates a slot after itself and selects the copy', () => {
    const state = start();
    const pen = state.slots[0];
    const next = toolbox(state, { type: 'duplicate', id: pen.id, newId: 'copy' });
    expect(next.slots[1]).toEqual({ ...pen, id: 'copy' });
    expect(next.selected).toBe('copy');
  });

  it('adds a pen at the end and selects it', () => {
    const next = toolbox(start(), { type: 'add', newId: 'new' });
    expect(next.slots.slice(-1)[0]).toMatchObject({ id: 'new', kind: 'pen' });
    expect(next.selected).toBe('new');
  });

  it('never removes the last slot', () => {
    let state = start();
    while (state.slots.length > 1) state = toolbox(state, { type: 'remove', id: state.slots[0].id });
    expect(toolbox(state, { type: 'remove', id: state.slots[0].id })).toBe(state);
  });

  it('selects a neighbour when the slot in hand goes, and forgets it everywhere', () => {
    let state = toolbox(start(), { type: 'select', id: idOf(start(), 'marker') });
    const marker = state.selected;
    state = toolbox(state, { type: 'remove', id: marker });
    expect(state.slots.some((s) => s.id === marker)).toBe(false);
    expect(selectedSlot(state).kind).toBe('pencil');
    expect(state.recents).not.toContain(marker);
    expect(state.previous).not.toBe(marker);
  });

  it('selects the one before when the last slot in the row goes', () => {
    let state = start();
    const last = state.slots.slice(-1)[0]!;
    state = toolbox(state, { type: 'select', id: last.id });
    state = toolbox(state, { type: 'remove', id: last.id });
    expect(selectedSlot(state).kind).toBe('eraser');
  });

  it('changes a slot to another kind with that kind’s width, keeping its colour', () => {
    const state = toolbox(start(), { type: 'setColor', color: '#ff3b30' });
    const next = toolbox(state, { type: 'changeKind', id: state.selected, kind: 'marker' });
    expect(selectedSlot(next)).toMatchObject({ kind: 'marker', color: '#ff3b30' });
    expect(presetWidths('marker')).toContain(selectedSlot(next).width);
  });

  it('reorders', () => {
    const state = start();
    const next = toolbox(state, { type: 'move', from: 0, to: 2 });
    expect(next.slots.map((s) => s.kind).slice(0, 3)).toEqual(['monoline', 'fountainPen', 'pen']);
    expect(toolbox(state, { type: 'move', from: 0, to: 99 })).toBe(state);
  });

  it('toggles the ruler and finger drawing', () => {
    expect(toolbox(start(), { type: 'toggleRuler' }).ruler).toBe(true);
    expect(toolbox(start(), { type: 'setFingerDraws', on: true }).fingerDraws).toBe(true);
  });

  it('keeps the corner the badge was thrown to', () => {
    expect(start().badgeCorner).toBe('bottom-right');
    expect(toolbox(start(), { type: 'setBadgeCorner', corner: 'top-left' }).badgeCorner).toBe('top-left');
    const state = start();
    expect(toolbox(state, { type: 'setBadgeCorner', corner: 'bottom-right' })).toBe(state);
  });
});

describe('sanitize', () => {
  it('starts over from garbage', () => {
    expect(sanitize(null)).toEqual(defaultToolbox());
    expect(sanitize('x')).toEqual(defaultToolbox());
    expect(sanitize({ slots: [] })).toEqual(defaultToolbox());
  });

  it('keeps what is good and drops or repairs the rest', () => {
    const state = sanitize({
      slots: [
        { id: 'a', kind: 'pen', color: '#FF0000', width: 4.2, opacity: 7, extra: true },
        { id: 'a', kind: 'pencil', color: '#00ff00', width: 2, opacity: 1 },
        { id: 'b', kind: 'laser', color: '#00ff00', width: 2, opacity: 1 },
        { id: 'c', kind: 'eraser', width: 'wide' },
        { kind: 'pen' },
      ],
      selected: 'zzz',
      previous: 'b',
      recents: ['c', 'gone', 'a', 'a'],
      recentColors: ['#abcdef', 'blue', '#ABCDEF'],
      ruler: 'yes',
      fingerDraws: true,
    });
    expect(state.slots.map((s) => s.id)).toEqual(['a', 'c']);
    expect(state.slots[0]).toEqual({ id: 'a', kind: 'pen', color: '#ff0000', width: 5, opacity: 1 });
    expect(state.slots[1]).toMatchObject({ id: 'c', kind: 'eraser', eraser: 'vector' });
    expect(state.selected).toBe('a');
    expect(state.previous).toBeNull();
    expect(state.recents).toEqual(['c', 'a']);
    expect(state.recentColors).toEqual(['#abcdef']);
    expect(state.ruler).toBe(false);
    expect(state.fingerDraws).toBe(true);
    expect(state.badgeCorner).toBe('bottom-right');
    expect(sanitize({ slots: [{ id: 'a', kind: 'pen' }], badgeCorner: 'top-left' }).badgeCorner).toBe('top-left');
    expect(sanitize({ slots: [{ id: 'a', kind: 'pen' }], badgeCorner: 'middle' }).badgeCorner).toBe('bottom-right');
  });
});

describe('badgeLook', () => {
  it('tints the menus\' color toward the ink in hand, translucent', () => {
    const look = badgeLook({ ...defaultToolbox().slots[0], color: '#ff3b30' });
    expect(look.rim).toBe('#ff3b30');
    expect(look.fill).toContain('#ff3b30');
    expect(look.fill).toContain('var(--popover)');
    expect(look.fill).toContain('70%');
  });

  it('is the menus\' own color for a tool with no ink', () => {
    const eraser = defaultToolbox().slots.find((s) => s.kind === 'eraser')!;
    expect(badgeLook(eraser)).toEqual({ fill: 'color-mix(in oklab, var(--popover) 70%, transparent)', rim: null });
  });
});

describe('toNative', () => {
  it('is what Swift reads (ToolSpec)', () => {
    const state = start();
    expect(toNative(state.slots[0])).toEqual({
      kind: 'pen',
      color: state.slots[0].color,
      width: state.slots[0].width,
      opacity: 1,
      eraser: 'vector',
    });
    const eraser = state.slots.find((s) => s.kind === 'eraser')!;
    expect(toNative({ ...eraser, eraser: 'bitmap' }).eraser).toBe('bitmap');
  });
});

describe('pencilAction', () => {
  it('follows Settings for a double tap', () => {
    expect(pencilAction({ gesture: 'tap', preference: 'switchEraser' })).toEqual({ type: 'toggleEraser' });
    expect(pencilAction({ gesture: 'tap', preference: 'switchPrevious' })).toEqual({ type: 'selectPrevious' });
    expect(pencilAction({ gesture: 'tap', preference: 'showColorPalette' })).toEqual({
      type: 'palette',
      page: 'colors',
    });
    expect(pencilAction({ gesture: 'tap', preference: 'showInkAttributes' })).toEqual({
      type: 'palette',
      page: 'width',
    });
    expect(pencilAction({ gesture: 'tap', preference: 'showContextualPalette' })).toEqual({
      type: 'palette',
      page: 'tools',
    });
    expect(pencilAction({ gesture: 'tap', preference: 'ignore' })).toEqual({ type: 'none' });
    expect(pencilAction({ gesture: 'tap', preference: 'runSystemShortcut' })).toEqual({ type: 'none' });
  });

  it('acts on a squeeze only once it ends', () => {
    expect(pencilAction({ gesture: 'squeeze', phase: 'began', preference: 'showContextualPalette' })).toEqual({
      type: 'none',
    });
    expect(pencilAction({ gesture: 'squeeze', phase: 'changed', preference: 'switchEraser' })).toEqual({
      type: 'none',
    });
    expect(pencilAction({ gesture: 'squeeze', phase: 'ended', preference: 'showContextualPalette' })).toEqual({
      type: 'palette',
      page: 'tools',
    });
    expect(pencilAction({ gesture: 'squeeze', phase: 'cancelled', preference: 'switchEraser' })).toEqual({
      type: 'none',
    });
  });
});
