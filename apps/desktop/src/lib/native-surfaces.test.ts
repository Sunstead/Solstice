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
  settings: { scratchOut: true, listeners: new Set<(value: boolean) => void>() },
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
  getSetting: () => settings.scratchOut,
  subscribeToSetting: (_key: string, listener: (value: boolean) => void) => {
    settings.listeners.add(listener);
    return () => settings.listeners.delete(listener);
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

describe('scratching out ink', () => {
  const change = (value: boolean) => {
    settings.scratchOut = value;
    settings.listeners.forEach((listener) => listener(value));
  };
  beforeEach(() => {
    ink.mockClear();
    settings.scratchOut = true;
  });

  it('tells the native side the setting once surfaces open, and as it changes', () => {
    change(false);
    expect(ink).not.toHaveBeenCalled();
    const release = retainHost();
    expect(ink).toHaveBeenLastCalledWith({ scratchOut: false });
    change(true);
    expect(ink).toHaveBeenLastCalledWith({ scratchOut: true });
    release();
    change(false);
    expect(ink).toHaveBeenCalledTimes(2);
  });
});
