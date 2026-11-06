// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  window.matchMedia ??= ((query: string) => ({
    matches: query === '(any-pointer: fine)',
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

import { useLayout } from '@/hooks/use-layout';
import { useWorkspace } from '@/hooks/use-workspace';
import { openExternalFiles } from './open-files';

const tabPaths = () => useLayout.getState().listTabPaths();

describe('openExternalFiles', () => {
  beforeEach(() => {
    useLayout.setState({ model: null, workspacePath: null });
    useWorkspace.setState({ path: null, loading: false });
  });

  it('opens files in a window with no workspace, as tabs of their own', () => {
    expect(openExternalFiles(['/Downloads/a.md', '/Desktop/b.md'])).toBe(true);
    expect(tabPaths()).toEqual(['/Downloads/a.md', '/Desktop/b.md']);
  });

  it('selects a file’s tab rather than opening it twice', () => {
    openExternalFiles(['/Downloads/a.md']);
    openExternalFiles(['/Downloads/a.md']);
    expect(tabPaths()).toEqual(['/Downloads/a.md']);
  });

  it('waits while a workspace’s layout is still loading', () => {
    useWorkspace.setState({ path: '/notes' });
    expect(openExternalFiles(['/Downloads/a.md'])).toBe(false);
    expect(useLayout.getState().model).toBeNull();
  });
});
