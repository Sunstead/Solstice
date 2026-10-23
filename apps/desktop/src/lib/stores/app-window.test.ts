import { describe, expect, it, vi } from 'vitest';

import { layoutFileFor, restoresLastWorkspace } from './app-window';

describe('layoutFileFor', () => {
  it('keeps layout.json for a full window', () => {
    expect(layoutFileFor({ label: 'main', kind: { type: 'full' } })).toBe('layout.json');
    expect(layoutFileFor({ label: 'w-ab', kind: { type: 'full' } })).toBe('layout.json');
  });

  it('gives each editor window its own', () => {
    expect(layoutFileFor({ label: 'w-ab', kind: { type: 'editor', parent: 'main' } })).toBe('layout-w-ab.json');
  });
});

describe('restoresLastWorkspace', () => {
  it('is only the first window, with nothing of its own to show', () => {
    expect(restoresLastWorkspace({ label: 'main', kind: { type: 'full' }, workspace: null })).toBe(true);
    expect(restoresLastWorkspace({ label: 'main', kind: { type: 'full' }, workspace: '/a' })).toBe(false);
    // A New Window starts empty, rather than on a workspace another window has.
    expect(restoresLastWorkspace({ label: 'w-1', kind: { type: 'full' }, workspace: null })).toBe(false);
  });
});

// React's StrictMode runs the startup effect twice in development. The
// backend hands a torn-off tab out once, so a second ask came back without
// it, replaced the first answer, and the new window closed with no tabs.
describe('loadAppWindow', async () => {
  const getWindowInit = vi.fn(async () => ({
    label: 'w-1',
    kind: { type: 'editor', parent: 'main' },
    workspace: '/ws',
    tab: '{"type":"tab"}',
  }));
  vi.doMock('@/lib/backend', () => ({ commands: { getWindowInit } }));
  vi.doMock('@/lib/backend/platform', () => ({ can: { multiWindow: true } }));
  vi.resetModules();
  const { loadAppWindow, useAppWindow } = await import('./app-window');

  it('asks once, however often it is called', async () => {
    getWindowInit.mockResolvedValueOnce({ label: 'w-1', kind: { type: 'editor', parent: 'main' }, workspace: '/ws', tab: '{"type":"tab"}' });
    getWindowInit.mockResolvedValue({ label: 'w-1', kind: { type: 'editor', parent: 'main' }, workspace: '/ws', tab: null } as never);
    await Promise.all([loadAppWindow(), loadAppWindow()]);
    await loadAppWindow();
    expect(getWindowInit).toHaveBeenCalledTimes(1);
    expect(useAppWindow.getState().tab).toBe('{"type":"tab"}');
  });
});
