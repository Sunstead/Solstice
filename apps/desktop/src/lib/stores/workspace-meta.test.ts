import { beforeEach, describe, expect, it, vi } from 'vitest';

const commands = {
  workspaceMeta: vi.fn(),
  syncPullColors: vi.fn(),
  setWorkspaceColor: vi.fn(),
};
vi.mock('@/lib/backend', () => ({ commands }));

const { useWorkspaceMeta, workspaceColor } = await import('./workspace-meta');
const { defaultWorkspaceColor } = await import('@/lib/workspace/color');

beforeEach(() => {
  vi.resetAllMocks();
  useWorkspaceMeta.setState({ colors: {} });
});

describe('workspaceColor', () => {
  it('is the stored color, else the one from the name', () => {
    expect(workspaceColor('School', '#4f7cc4')).toBe('#4f7cc4');
    expect(workspaceColor('School', null)).toBe(defaultWorkspaceColor('School'));
    expect(workspaceColor('School', undefined)).toBe(defaultWorkspaceColor('School'));
  });
});

describe('useWorkspaceMeta', () => {
  it('shows what is on disk, then what the server has', async () => {
    commands.workspaceMeta.mockResolvedValue([{ color: '#111111' }, { color: null }]);
    let pulled!: (v: unknown) => void;
    commands.syncPullColors.mockReturnValue(new Promise((r) => (pulled = r)));

    const loading = useWorkspaceMeta.getState().load(['/a', '/b']);
    await vi.waitFor(() => expect(useWorkspaceMeta.getState().colors).toEqual({ '/a': '#111111', '/b': null }));
    pulled([{ color: '#222222' }, { color: '#333333' }]);
    await loading;
    expect(useWorkspaceMeta.getState().colors).toEqual({ '/a': '#222222', '/b': '#333333' });
  });

  it('keeps other workspaces it already knows', async () => {
    useWorkspaceMeta.setState({ colors: { '/old': '#999999' } });
    commands.workspaceMeta.mockResolvedValue([{ color: null }]);
    commands.syncPullColors.mockResolvedValue([{ color: null }]);
    await useWorkspaceMeta.getState().load(['/a']);
    expect(useWorkspaceMeta.getState().colors).toEqual({ '/old': '#999999', '/a': null });
  });

  it('shows a picked color at once, and the saved one after', async () => {
    commands.setWorkspaceColor.mockResolvedValue({ status: 'ok', data: { color: '#aabbcc' } });
    const saving = useWorkspaceMeta.getState().setColor('/a', '#ABC');
    expect(useWorkspaceMeta.getState().colors['/a']).toBe('#ABC');
    expect(await saving).toBeNull();
    expect(useWorkspaceMeta.getState().colors['/a']).toBe('#aabbcc');
  });

  it('puts the old color back if saving fails, and says why', async () => {
    useWorkspaceMeta.setState({ colors: { '/a': '#111111' } });
    commands.setWorkspaceColor.mockResolvedValue({ status: 'error', error: 'read-only folder' });
    expect(await useWorkspaceMeta.getState().setColor('/a', '#222222')).toBe('read-only folder');
    expect(useWorkspaceMeta.getState().colors['/a']).toBe('#111111');
  });

  it('a pull that fails leaves what was read from disk', async () => {
    commands.workspaceMeta.mockResolvedValue([{ color: '#111111' }]);
    commands.syncPullColors.mockRejectedValue(new Error('offline'));
    await useWorkspaceMeta.getState().load(['/a']);
    expect(useWorkspaceMeta.getState().colors).toEqual({ '/a': '#111111' });
  });
});
