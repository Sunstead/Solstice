import { describe, expect, it, vi } from 'vitest';
import { TabNode } from 'flexlayout-react';

// A new editor window loads its layout twice as it starts (the workspace's
// stores, then the layout session). The second load must not lose the tab
// torn off another window: with none, the window closed itself at once.
vi.mock('@/lib/stores/workspace-layout', () => ({
  getStoredLayout: vi.fn(async () => null),
  setStoredLayout: vi.fn(async () => {}),
}));
vi.mock('@/lib/settings/store', () => ({ getSetting: vi.fn() }));
vi.mock('@/lib/backend/platform', () => ({ shell: 'desktop', can: {} }));

describe('loadForWorkspace', async () => {
  const { useLayout } = await import('./use-layout');
  const { useAppWindow } = await import('@/lib/stores/app-window');

  it('keeps a torn-off tab when two loads overlap', async () => {
    useAppWindow.setState({
      label: 'w-1',
      kind: { type: 'editor', parent: 'main' },
      tab: JSON.stringify({ type: 'tab', id: 't', name: 'A.md', component: 'editor', config: { path: '/ws/A.md' } }),
    });

    await Promise.all([
      useLayout.getState().loadForWorkspace('/ws'),
      useLayout.getState().loadForWorkspace('/ws'),
    ]);

    const tabs: string[] = [];
    useLayout.getState().model!.visitNodes((n) => {
      if (n instanceof TabNode) tabs.push(n.getId());
    });
    expect(tabs).toEqual(['t']);
  });

  it('saves a torn-off tab at once, for any later load', async () => {
    const { setStoredLayout } = await import('@/lib/stores/workspace-layout');
    expect(setStoredLayout).toHaveBeenCalledWith(expect.objectContaining({ layout: expect.anything() }));
  });
});
