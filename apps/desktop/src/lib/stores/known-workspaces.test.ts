import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/backend', () => ({ commands: {} }));
vi.mock('@/lib/backend/platform', () => ({ shell: 'web' }));
vi.mock('@/lib/backend/store', () => ({ load: vi.fn() }));

describe('rerooted', async () => {
  const { rerooted } = await import('./known-workspaces');
  const now = '/data/Containers/Data/Application/NEW/Documents';

  it('moves a workspace under the current Documents', () => {
    expect(rerooted('/data/Containers/Data/Application/OLD/Documents/Business', now)).toBe(`${now}/Business`);
    expect(rerooted('/data/Containers/Data/Application/OLD/Documents/Notes/Work', `${now}/`)).toBe(`${now}/Notes/Work`);
  });

  it('leaves a path outside Documents alone', () => {
    expect(rerooted('/Users/me/Notes', now)).toBe('/Users/me/Notes');
    expect(rerooted('/x/Documents/Business', null)).toBe('/x/Documents/Business');
  });
});
