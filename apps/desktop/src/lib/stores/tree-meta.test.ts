import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TreeMetaState } from '@/bindings';

const commands = { treeMeta: vi.fn(), treeMetaApply: vi.fn() };
vi.mock('@/lib/backend', () => ({ commands, events: {} }));
vi.mock('@/hooks/use-workspace', () => ({ useWorkspace: () => null }));

const { useTreeMeta } = await import('./tree-meta');

const state = (bookmarks: [string, string][], linked = false): TreeMetaState => ({
  linked,
  bookmarks: bookmarks.map(([id, path]) => ({ id, path })),
  folder_colors: {},
});
const paths = () => useTreeMeta.getState().meta.bookmarks.map((b) => b.path);

beforeEach(() => {
  vi.resetAllMocks();
  useTreeMeta.getState().reset();
});

describe('useTreeMeta', () => {
  it('loads a workspace, and forgets it on reset', async () => {
    commands.treeMeta.mockResolvedValue({ status: 'ok', data: state([['a', 'A.md']], true) });
    await useTreeMeta.getState().load('/ws');
    expect(commands.treeMeta).toHaveBeenCalledWith('/ws');
    expect(paths()).toEqual(['A.md']);
    expect(useTreeMeta.getState().linked).toBe(true);
    useTreeMeta.getState().reset();
    expect(paths()).toEqual([]);
    expect(useTreeMeta.getState().root).toBeNull();
  });

  it('a load for a workspace since left is dropped', async () => {
    let answer!: (v: unknown) => void;
    commands.treeMeta.mockReturnValueOnce(new Promise((r) => (answer = r)));
    const first = useTreeMeta.getState().load('/old');
    commands.treeMeta.mockResolvedValueOnce({ status: 'ok', data: state([['b', 'B.md']]) });
    await useTreeMeta.getState().load('/new');
    answer({ status: 'ok', data: state([['a', 'A.md']]) });
    await first;
    expect(paths()).toEqual(['B.md']);
  });

  it('shows a change at once, then what the backend kept', async () => {
    commands.treeMeta.mockResolvedValue({ status: 'ok', data: state([]) });
    await useTreeMeta.getState().load('/ws');
    let answer!: (v: unknown) => void;
    commands.treeMetaApply.mockReturnValue(new Promise((r) => (answer = r)));
    const toggling = useTreeMeta.getState().toggleBookmark('/ws/notes/Plan.md');
    expect(paths()).toEqual(['notes/Plan.md']);
    expect(useTreeMeta.getState().isBookmarked('/ws/notes/Plan.md')).toBe(true);
    await vi.waitFor(() => expect(commands.treeMetaApply).toHaveBeenCalled());
    const [root, ops] = commands.treeMetaApply.mock.calls[0];
    expect(root).toBe('/ws');
    expect(ops).toEqual([{ op: 'add_bookmark', id: expect.any(String), path: 'notes/Plan.md' }]);
    answer({ status: 'ok', data: state([['x', 'notes/Plan.md'], ['y', 'Other.md']]) });
    await toggling;
    expect(paths()).toEqual(['notes/Plan.md', 'Other.md']);
  });

  it('puts things back when the backend refuses, and says why', async () => {
    commands.treeMeta.mockResolvedValue({ status: 'ok', data: state([['a', 'A.md']]) });
    await useTreeMeta.getState().load('/ws');
    commands.treeMetaApply.mockResolvedValue({ status: 'error', error: 'read-only' });
    expect(await useTreeMeta.getState().toggleBookmark('/ws/A.md')).toBe('read-only');
    expect(paths()).toEqual(['A.md']);
  });

  it('keeps changes still on their way over a reply or a reload', async () => {
    commands.treeMeta.mockResolvedValue({ status: 'ok', data: state([]) });
    await useTreeMeta.getState().load('/ws');
    const answers: ((v: unknown) => void)[] = [];
    commands.treeMetaApply.mockImplementation(() => new Promise((r) => answers.push(r)));
    const one = useTreeMeta.getState().toggleBookmark('/ws/A.md');
    const two = useTreeMeta.getState().toggleBookmark('/ws/B.md');
    expect(paths()).toEqual(['A.md', 'B.md']);
    // One at a time: the second waits for the first.
    await vi.waitFor(() => expect(answers).toHaveLength(1));
    commands.treeMeta.mockResolvedValue({ status: 'ok', data: state([['z', 'Z.md']]) });
    await useTreeMeta.getState().load('/ws');
    expect(paths()).toEqual(['Z.md', 'A.md', 'B.md']);
    answers[0]({ status: 'ok', data: state([['z', 'Z.md'], ['a', 'A.md']]) });
    await vi.waitFor(() => expect(answers).toHaveLength(2));
    expect(paths()).toEqual(['Z.md', 'A.md', 'B.md']);
    answers[1]({ status: 'ok', data: state([['z', 'Z.md'], ['a', 'A.md'], ['b', 'B.md']]) });
    await Promise.all([one, two]);
    expect(paths()).toEqual(['Z.md', 'A.md', 'B.md']);
  });

  it('carries renames and forgets deletes by workspace path', async () => {
    commands.treeMeta.mockResolvedValue({ status: 'ok', data: state([['a', 'Notes/A.md']]) });
    await useTreeMeta.getState().load('/ws');
    let answer!: (v: unknown) => void;
    commands.treeMetaApply.mockReturnValue(new Promise((r) => (answer = r)));
    const sent = [useTreeMeta.getState().retarget('/ws/Notes', '/ws/Archive')];
    expect(paths()).toEqual(['Archive/A.md']);
    sent.push(useTreeMeta.getState().forget('/ws/Archive'));
    expect(paths()).toEqual([]);
    sent.push(useTreeMeta.getState().setFolderColor('/ws/Projects', '#E5484D'));
    expect(useTreeMeta.getState().folderColor('/ws/Projects')).toBe('#e5484d');
    await vi.waitFor(() => expect(commands.treeMetaApply).toHaveBeenCalled());
    answer({ status: 'ok', data: state([]) });
    await Promise.all(sent);
    // Nothing outside the workspace, or the workspace itself, is sent.
    commands.treeMetaApply.mockClear();
    await useTreeMeta.getState().forget('/elsewhere/x');
    expect(commands.treeMetaApply).not.toHaveBeenCalled();
  });
});
