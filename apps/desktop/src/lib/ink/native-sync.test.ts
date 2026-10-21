// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const nativeInk = vi.hoisted(() => ({
  listen: vi.fn(() => Promise.resolve({ unregister: vi.fn() })),
  setTool: vi.fn(),
  setRuler: vi.fn(),
  setFingerDraws: vi.fn(),
  undoState: vi.fn(),
}));
vi.mock('@/lib/backend/native', () => ({ nativeInk }));
vi.mock('@/lib/stores/scoped-storage', () => ({
  createScopedStorage: () => ({ getItem: () => null, setItem: () => {}, removeItem: () => {} }),
}));

import { useInkTools, useInkUi } from '@/lib/stores/ink-tools';
import { followInkTools, onInkEvent } from './native-sync';
import { defaultToolbox, selectedSlot, toNative } from './toolbox';

beforeEach(() => {
  useInkTools.setState(defaultToolbox());
  useInkUi.setState({ canUndo: false, canRedo: false, palette: null, paletteAt: null });
  vi.clearAllMocks();
});

describe('onInkEvent', () => {
  it('does what Settings asks of a double tap', () => {
    onInkEvent({ type: 'pencil', gesture: 'tap', preference: 'switchEraser' });
    expect(selectedSlot(useInkTools.getState()).kind).toBe('eraser');
    onInkEvent({ type: 'pencil', gesture: 'tap', preference: 'switchEraser' });
    expect(selectedSlot(useInkTools.getState()).kind).toBe('pen');
  });

  it('opens the palette where the Pencil hovers on a squeeze, and a second puts it away', () => {
    onInkEvent({
      type: 'pencil',
      gesture: 'squeeze',
      phase: 'began',
      preference: 'showContextualPalette',
      x: 10,
      y: 20,
    });
    expect(useInkUi.getState().palette).toBeNull();
    onInkEvent({
      type: 'pencil',
      gesture: 'squeeze',
      phase: 'ended',
      preference: 'showContextualPalette',
      x: 10,
      y: 20,
      azimuth: 0.5,
    });
    expect(useInkUi.getState().palette).toEqual({ x: 10, y: 20, azimuth: 0.5, page: 'tools' });
    onInkEvent({ type: 'pencil', gesture: 'squeeze', phase: 'ended', preference: 'showContextualPalette' });
    expect(useInkUi.getState().palette).toBeNull();
  });

  it('opens on the colours for Show Colour Palette, in the middle when not hovering', () => {
    onInkEvent({ type: 'pencil', gesture: 'tap', preference: 'showColorPalette' });
    expect(useInkUi.getState().palette).toMatchObject({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
      page: 'colors',
    });
  });

  // The Pencil's position is only reported while it hovers; a squeeze off the
  // screen says nothing, and the menu should go back to where it last was.
  it('reopens where it was last seen when the squeeze reports no position', () => {
    onInkEvent({ type: 'pencil', gesture: 'squeeze', phase: 'ended', preference: 'showContextualPalette', x: 10, y: 20 });
    expect(useInkUi.getState().palette).toMatchObject({ x: 10, y: 20 });
    onInkEvent({ type: 'pencil', gesture: 'squeeze', phase: 'ended', preference: 'showContextualPalette' });
    expect(useInkUi.getState().palette).toBeNull();
    onInkEvent({ type: 'pencil', gesture: 'squeeze', phase: 'ended', preference: 'showContextualPalette' });
    expect(useInkUi.getState().palette).toMatchObject({ x: 10, y: 20, page: 'tools' });
  });

  it("takes Apple's picker's colour, keeping only where it settles", () => {
    onInkEvent({ type: 'color', color: '#123456', opacity: 0.5, final: false });
    expect(selectedSlot(useInkTools.getState())).toMatchObject({ color: '#123456', opacity: 0.5 });
    expect(useInkTools.getState().recentColors).toEqual([]);
    onInkEvent({ type: 'color', color: '#123456', opacity: 0.5, final: true });
    expect(useInkTools.getState().recentColors).toEqual(['#123456']);
  });

  it('follows undo', () => {
    onInkEvent({ type: 'undo', canUndo: true, canRedo: false });
    expect(useInkUi.getState()).toMatchObject({ canUndo: true, canRedo: false });
  });
});

describe('followInkTools', () => {
  it('sends the tool in hand, then only what changes', () => {
    const stop = followInkTools();
    expect(nativeInk.setTool).toHaveBeenCalledWith(toNative(selectedSlot(useInkTools.getState())));
    vi.clearAllMocks();
    useInkTools.getState().dispatch({ type: 'toggleRuler' });
    expect(nativeInk.setRuler).toHaveBeenCalledWith(true);
    expect(nativeInk.setTool).not.toHaveBeenCalled();
    useInkTools.getState().dispatch({ type: 'setColor', color: '#ff0000' });
    expect(nativeInk.setTool).toHaveBeenCalledWith(expect.objectContaining({ color: '#ff0000' }));
    stop();
  });
});
