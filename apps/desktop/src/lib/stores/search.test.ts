import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Results } from '@/bindings';

const searchWorkspace = vi.fn();
vi.mock('@/lib/backend', () => ({ commands: { searchWorkspace } }));

const results = (total: number): Results => ({ files: [], total, truncated: false });
const ok = (data: Results) => ({ status: 'ok', data });

describe('the search store', async () => {
  const { useSearchStore } = await import('./search');

  beforeEach(() => {
    searchWorkspace.mockReset();
    useSearchStore.setState({ query: '', caseSensitive: false, wholeWord: false, results: null, pending: false, error: null });
  });

  it('searches with the query and options', async () => {
    searchWorkspace.mockResolvedValueOnce(ok(results(3)));
    useSearchStore.setState({ query: 'cell', wholeWord: true });
    await useSearchStore.getState().run('/ws', ['Archive']);
    expect(searchWorkspace).toHaveBeenCalledWith('/ws', { text: 'cell', case_sensitive: false, whole_word: true }, ['Archive']);
    expect(useSearchStore.getState().results?.total).toBe(3);
    expect(useSearchStore.getState().pending).toBe(false);
  });

  it('clears for an empty query without asking', async () => {
    useSearchStore.setState({ results: results(2) });
    await useSearchStore.getState().run('/ws', []);
    expect(searchWorkspace).not.toHaveBeenCalled();
    expect(useSearchStore.getState().results).toBeNull();
  });

  it('drops a reply that a newer search overtook', async () => {
    let finishFirst: (value: unknown) => void = () => {};
    searchWorkspace.mockReturnValueOnce(new Promise((resolve) => (finishFirst = resolve)));
    searchWorkspace.mockResolvedValueOnce(ok(results(2)));
    useSearchStore.setState({ query: 'ce' });
    const first = useSearchStore.getState().run('/ws', []);
    useSearchStore.setState({ query: 'cell' });
    await useSearchStore.getState().run('/ws', []);
    finishFirst(ok(results(9)));
    await first;
    expect(useSearchStore.getState().results?.total).toBe(2);
  });

  it('keeps the last results and says what went wrong', async () => {
    useSearchStore.setState({ query: 'cell', results: results(1) });
    searchWorkspace.mockResolvedValueOnce({ status: 'error', error: 'offline' });
    await useSearchStore.getState().run('/ws', []);
    expect(useSearchStore.getState().error).toBe('offline');
    expect(useSearchStore.getState().results?.total).toBe(1);
  });
});

describe('parseExcludes', async () => {
  const { parseExcludes } = await import('./search');
  it('splits the setting on commas', () => {
    expect(parseExcludes(' Archive, Templates/Old ,,')).toEqual(['Archive', 'Templates/Old']);
    expect(parseExcludes('')).toEqual([]);
  });
});
