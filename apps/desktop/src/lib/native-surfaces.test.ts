// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});
const { webFocus, ink, listen, fileWritten, settings } = vi.hoisted(() => ({
  webFocus: vi.fn(),
  ink: vi.fn(),
  listen: vi.fn((_: (event: unknown) => void) => Promise.resolve({ unregister: () => {} })),
  fileWritten: vi.fn(),
  settings: {
    scratchOut: true,
    darkPaper: false,
    listeners: new Map<string, Set<(value: boolean) => void>>(),
  },
}));
vi.mock('@/lib/backend/native', () => ({
  nativeKeyboard: { listen: vi.fn() },
  nativeInk: {
    listen: vi.fn(() => Promise.resolve({ unregister: vi.fn() })),
    setTool: vi.fn(),
    setRuler: vi.fn(),
    setFingerDraws: vi.fn(),
    undoState: vi.fn(),
  },
  nativeSurfaces: {
    listen,
    webFocus,
    ink,
    overlays: vi.fn(),
    background: vi.fn(),
  },
}));
vi.mock('@/lib/backend', () => ({ commands: { fileWritten } }));
vi.mock('@/lib/stores/scoped-storage', () => ({
  createScopedStorage: () => ({ getItem: () => null, setItem: () => {}, removeItem: () => {} }),
}));
vi.mock('@/lib/backend/platform', () => ({ can: { nativeViews: true } }));
vi.mock('@/lib/settings/store', () => ({
  getSetting: (key: string) => (key === 'ink.darkPaper' ? settings.darkPaper : settings.scratchOut),
  subscribeToSetting: (key: string, listener: (value: boolean) => void) => {
    const listeners = settings.listeners.get(key) ?? new Set();
    settings.listeners.set(key, listeners);
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
}));

import { useEditingFocus } from './keyboard';
import { follow, retainHost } from './native-surfaces';

describe('web focus, while surfaces are open', () => {
  let release: () => void;
  const field = document.createElement('input');

  beforeEach(() => {
    vi.useFakeTimers();
    webFocus.mockClear();
    useEditingFocus.setState({ element: null, note: false });
    release = retainHost();
  });
  afterEach(() => {
    release();
    vi.useRealTimers();
  });

  it('tells the native side at once when text takes focus, so the tools go', () => {
    useEditingFocus.setState({ element: field });
    expect(webFocus).toHaveBeenCalledWith(true);
  });

  it('gives the tools back once focus has left', () => {
    useEditingFocus.setState({ element: field });
    useEditingFocus.setState({ element: null });
    expect(webFocus).not.toHaveBeenCalledWith(false);
    vi.advanceTimersByTime(200);
    expect(webFocus).toHaveBeenLastCalledWith(false);
  });

  it('says nothing as focus moves from one field to the next', () => {
    useEditingFocus.setState({ element: field });
    useEditingFocus.setState({ element: null });
    useEditingFocus.setState({ element: document.createElement('textarea') });
    vi.advanceTimersByTime(200);
    expect(webFocus.mock.calls).toEqual([[true]]);
  });
});

describe('ink settings', () => {
  const change = (key: string, value: boolean) => {
    if (key === 'ink.darkPaper') settings.darkPaper = value;
    else settings.scratchOut = value;
    settings.listeners.get(key)?.forEach((listener) => listener(value));
  };
  beforeEach(() => {
    ink.mockClear();
    settings.scratchOut = true;
    settings.darkPaper = false;
  });

  it('tells the native side the settings once surfaces open, and as they change', () => {
    change('ink.scratchOut', false);
    expect(ink).not.toHaveBeenCalled();
    const release = retainHost();
    expect(ink).toHaveBeenLastCalledWith({ scratchOut: false, darkPaper: false });
    change('ink.scratchOut', true);
    expect(ink).toHaveBeenLastCalledWith({ scratchOut: true });
    change('ink.darkPaper', true);
    expect(ink).toHaveBeenLastCalledWith({ darkPaper: true });
    release();
    change('ink.scratchOut', false);
    change('ink.darkPaper', false);
    expect(ink).toHaveBeenCalledTimes(3);
  });
});

describe('saves', () => {
  it('asks for a final save to be synced at once, and others soon', () => {
    const release = retainHost();
    const onEvent = listen.mock.calls[listen.mock.calls.length - 1][0];
    onEvent({ id: 'a', type: 'saved', path: '/w/a.pdf', final: true });
    expect(fileWritten).toHaveBeenLastCalledWith('/w/a.pdf', true);
    onEvent({ id: 'a', type: 'saved', path: '/w/a.pdf' });
    expect(fileWritten).toHaveBeenLastCalledWith('/w/a.pdf', false);
    release();
  });
});

describe('following a surface', () => {
  /** An animation as `getAnimations` lists it, running `iterations` times. */
  const animation = (iterations: number) =>
    ({ effect: { getTiming: () => ({ iterations }) } }) as unknown as Animation;
  let running: Animation[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    globalThis.ResizeObserver ??= class {
      observe() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    document.getAnimations = () => running;
  });
  afterEach(() => {
    running = [];
    vi.useRealTimers();
  });

  /** How many frames `measure` runs in a second, after the first. */
  const framesInASecond = (measure: () => boolean) => {
    vi.advanceTimersByTime(1000);
    const before = vi.mocked(measure).mock.calls.length;
    vi.advanceTimersByTime(1000);
    return vi.mocked(measure).mock.calls.length - before;
  };

  // A spinner (sync connecting) kept it measuring every frame for as long
  // as it spun.
  it('stops while only something endless animates, like a spinner', () => {
    running = [animation(Infinity)];
    const measure = vi.fn(() => false);
    const stop = follow(document.createElement('div'), measure);
    expect(framesInASecond(measure)).toBe(0);
    stop();
  });

  it('keeps going while something that ends is animating', () => {
    running = [animation(1)];
    const measure = vi.fn(() => false);
    const stop = follow(document.createElement('div'), measure);
    expect(framesInASecond(measure)).toBeGreaterThan(10);
    stop();
  });
});
