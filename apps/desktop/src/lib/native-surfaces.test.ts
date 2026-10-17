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
const { webFocus, ink, settings } = vi.hoisted(() => ({
  webFocus: vi.fn(),
  ink: vi.fn(),
  settings: {
    scratchOut: true,
    darkPaper: false,
    listeners: new Map<string, Set<(value: boolean) => void>>(),
  },
}));
vi.mock('@/lib/backend/native', () => ({
  nativeKeyboard: { listen: vi.fn() },
  nativeSurfaces: {
    listen: vi.fn(() => Promise.resolve({ unregister: vi.fn() })),
    webFocus,
    ink,
    overlays: vi.fn(),
    background: vi.fn(),
  },
}));
vi.mock('@/lib/backend', () => ({ commands: { fileWritten: vi.fn() } }));
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
import { retainHost } from './native-surfaces';

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
