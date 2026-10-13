import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FileEntry } from '@/bindings';

// A folder read that fails (the iPad out of file descriptors, say) must never
// read as "the folder is empty": that pruned the whole tree.
const listDirectory = vi.fn();
const listWorkspaceFilesRecursive = vi.fn();
vi.mock('@/lib/backend', () => ({ commands: { listDirectory, listWorkspaceFilesRecursive } }));
vi.mock('@/lib/settings/store', () => ({ useSetting: vi.fn() }));
vi.mock('@/lib/stores/workspace-ui-store', () => ({
  useWorkspaceUIStore: {
    getState: () => ({
      expandedFolders: [],
      setExpandedFolders: vi.fn(),
      setFolderExpanded: vi.fn(),
      forgetExpandedSubtree: vi.fn(),
    }),
  },
}));

const file = (path: string, is_dir = false): FileEntry => ({
  path,
  name: path.split('/').pop()!,
  is_dir,
});
const ok = (data: FileEntry[]) => ({ status: 'ok', data });
const failed = { status: 'error', error: 'Too many open files (os error 24)' };

describe('a failed read', async () => {
  const { useFiles } = await import('./use-files');
  const { useFileIndex } = await import('@/lib/stores/use-file-index');

  beforeEach(() => {
    useFiles.getState().reset();
    useFileIndex.getState().reset();
  });

  it('leaves the tree as it was', async () => {
    listDirectory.mockResolvedValueOnce(ok([file('/v/a.md'), file('/v/notes', true)]));
    await useFiles.getState().loadRoot('/v');
    expect(Object.keys(useFiles.getState().entries).sort()).toEqual(['/v/a.md', '/v/notes']);

    listDirectory.mockResolvedValueOnce(failed);
    await useFiles.getState().refreshDirectory('/v');
    expect(Object.keys(useFiles.getState().entries).sort()).toEqual(['/v/a.md', '/v/notes']);

    // A folder that can't be read isn't marked as read (and empty).
    listDirectory.mockResolvedValueOnce(failed);
    await useFiles.getState().expandDirectory('/v/notes');
    expect(useFiles.getState().entries['/v/notes'].childrenLoaded).toBe(false);
  });

  it('keeps the index it had', async () => {
    listWorkspaceFilesRecursive.mockResolvedValueOnce(ok([file('/v/a.md')]));
    expect(await useFileIndex.getState().loadIndex('/v')).toBe(true);

    listWorkspaceFilesRecursive.mockResolvedValueOnce(failed);
    expect(await useFileIndex.getState().loadIndex('/v')).toBe(false);
    expect(useFileIndex.getState().files.map((f) => f.path)).toEqual(['/v/a.md']);

    // Another workspace's files are no use, though.
    listWorkspaceFilesRecursive.mockResolvedValueOnce(failed);
    expect(await useFileIndex.getState().loadIndex('/w')).toBe(false);
    expect(useFileIndex.getState().files).toEqual([]);
  });
});
