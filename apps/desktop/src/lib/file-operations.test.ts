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

import { commands } from '@/lib/backend';
import { useFiles } from '@/hooks/use-files';
import { useWorkspace } from '@/hooks/use-workspace';
import { fileOperations } from '@/lib/file-operations';
import { useFileIndex } from '@/lib/stores/use-file-index';

describe('copyDropped', () => {
  const refresh = vi.fn(async () => {});
  const loadIndex = vi.fn(async () => true);

  beforeEach(() => {
    vi.restoreAllMocks();
    refresh.mockClear();
    loadIndex.mockClear();
    useWorkspace.setState({ path: '/w' });
    useFiles.setState({ refreshDirectory: refresh } as never);
    useFileIndex.setState({ loadIndex } as never);
  });

  it('copies what the drop’s paths name into the folder, files and folders alike', async () => {
    vi.spyOn(commands, 'takeDroppedPaths').mockResolvedValue(['/Downloads/a.md', '/Downloads/trip']);
    const copy = vi.spyOn(commands, 'importAttachment').mockResolvedValue({ status: 'ok', data: '/w/sub/a.md' });
    await fileOperations.copyDropped('/w/sub', []);
    expect(copy.mock.calls).toEqual([
      ['/Downloads/a.md', '/w/sub'],
      ['/Downloads/trip', '/w/sub'],
    ]);
  });

  it('shows what arrived: the watcher ignores the app’s own writes', async () => {
    vi.spyOn(commands, 'takeDroppedPaths').mockResolvedValue(['/Downloads/trip']);
    vi.spyOn(commands, 'importAttachment').mockResolvedValue({ status: 'ok', data: '/w/sub/trip' });
    await fileOperations.copyDropped('/w/sub', []);
    expect(refresh).toHaveBeenCalledWith('/w/sub');
    expect(loadIndex).toHaveBeenCalledWith('/w');
  });

  it('writes the dropped bytes where the platform gives no paths', async () => {
    vi.spyOn(commands, 'takeDroppedPaths').mockResolvedValue([]);
    const save = vi.spyOn(commands, 'saveAttachment').mockResolvedValue({ status: 'ok', data: '/w/a.txt' });
    const file = { name: 'a.txt', arrayBuffer: async () => new TextEncoder().encode('hi').buffer } as File;
    await fileOperations.copyDropped('/w', [file]);
    expect(save).toHaveBeenCalledWith('/w', 'a.txt', [104, 105]);
  });
});
