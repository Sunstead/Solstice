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
const { webFocus } = vi.hoisted(() => ({ webFocus: vi.fn() }));
vi.mock('@/lib/backend/native', () => ({
  nativeKeyboard: { listen: vi.fn() },
  nativeSurfaces: {
    listen: vi.fn(() => Promise.resolve({ unregister: vi.fn() })),
    webFocus,
    overlays: vi.fn(),
    background: vi.fn(),
  },
}));
vi.mock('@/lib/backend', () => ({ commands: { fileWritten: vi.fn() } }));
vi.mock('@/lib/backend/platform', () => ({ can: { nativeViews: true } }));

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
