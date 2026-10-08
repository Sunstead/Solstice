import { beforeEach, describe, expect, it, vi } from 'vitest';

import { memoryStore, type JournalStore } from './journal';

/**
 * A server with one note. A save applies once per `save_id`; `base` is the
 * version it was read at. `drop` loses the next reply after applying it, and
 * `down` refuses to connect at all.
 */
const server = {
  text: 'one\n',
  version: 0,
  applied: [] as { base: string | null; text: string; id: string }[],
  seen: new Set<string>(),
  created: [] as { path: string; text: string }[],
  down: false,
  drop: false,
  refuse: 0,
};

const reply = () => ({ path: 'Plan.md', text: server.text, base: String(server.version) });

async function fakeApiJson(path: string, init: { method?: string; body?: string; json?: unknown } = {}) {
  if (server.down) throw new TypeError('Failed to fetch');
  if (path.endsWith('/ops')) {
    const op = init.json as { path: string; text: string };
    server.created.push({ path: op.path, text: op.text });
    return {};
  }
  if (init.method !== 'PUT') return reply();
  if (server.refuse) {
    // The copy the freshly loaded module sees, after `resetModules`.
    const { ApiError } = await import('./api');
    throw new ApiError(server.refuse, 'conflict', 'stale');
  }
  const body = JSON.parse(init.body ?? '{}') as { text: string; base: string | null; save_id: string };
  if (!server.seen.has(body.save_id)) {
    server.seen.add(body.save_id);
    server.applied.push({ base: body.base, text: body.text, id: body.save_id });
    server.text = body.text;
    server.version += 1;
  }
  if (server.drop) {
    server.drop = false;
    throw new TypeError('The network connection was lost.');
  }
  return reply();
}

vi.mock('./api', async (original) => ({
  ...(await original<typeof import('./api')>()),
  apiJson: (path: string, init?: object) => fakeApiJson(path, init),
  api: async () => new Response(''),
}));

const vault = { id: 'v1', name: 'Notes' };
vi.mock('./vault', async () => {
  const { Emitter } = await import('./emitter');
  return {
    resolve: async (path: string) => ({ vault, rel: path.replace('/Notes/', '') }),
    vaultUrl: (_v: unknown, route: string, rel = '') => `/v1/vaults/v1/${route}${rel ? `/${rel}` : ''}`,
    rootOf: () => '/Notes',
    refresh: async () => {},
    fsChanged: new Emitter(),
    connected: new Emitter(),
  };
});

let store: JournalStore;

/** A fresh page: the module's memory gone, the journal kept. */
async function load() {
  vi.resetModules();
  const notes = await import('./notes');
  notes.useJournal(store);
  return notes;
}

describe('web note saves', () => {
  beforeEach(() => {
    Object.assign(server, {
      text: 'one\n',
      version: 0,
      applied: [],
      seen: new Set(),
      created: [],
      down: false,
      drop: false,
      refuse: 0,
    });
    store = memoryStore();
  });

  it('saves against the base it read, and leaves nothing journaled', async () => {
    const notes = await load();
    expect(await notes.readNote('/Notes/Plan.md')).toBe('one\n');
    await notes.saveFile('/Notes/Plan.md', 'one\ntwo\n', true);
    expect(server.applied).toEqual([{ base: '0', text: 'one\ntwo\n', id: expect.any(String) }]);
    expect(await store.all()).toEqual([]);
  });

  it('keeps an edit made offline through a reload, and sends it on opening', async () => {
    let notes = await load();
    await notes.readNote('/Notes/Plan.md');
    server.down = true;
    await expect(notes.saveFile('/Notes/Plan.md', 'one\nOFFLINE\n', true)).rejects.toThrow();
    expect((await store.all())[0].latest).toBe('one\nOFFLINE\n');

    server.down = false;
    notes = await load();
    expect(await notes.readNote('/Notes/Plan.md')).toBe('one\nOFFLINE\n');
    expect(server.applied.map((a) => a.base)).toEqual(['0']);
    expect(await store.all()).toEqual([]);
  });

  it('sends a save whose reply was lost again, once, before anything newer', async () => {
    const notes = await load();
    await notes.readNote('/Notes/Plan.md');
    server.drop = true;
    await expect(notes.saveFile('/Notes/Plan.md', 'one\ntwo\n', true)).rejects.toThrow();
    await notes.saveFile('/Notes/Plan.md', 'one\ntwo\nthree\n', true);
    // The lost one landed once; the next went from where it left the note.
    expect(server.applied.map((a) => [a.base, a.text])).toEqual([
      ['0', 'one\ntwo\n'],
      ['1', 'one\ntwo\nthree\n'],
    ]);
  });

  it('keeps a save the server refuses beside the note', async () => {
    const notes = await load();
    await notes.readNote('/Notes/Plan.md');
    server.refuse = 409;
    await notes.saveFile('/Notes/Plan.md', 'mine\n', true);
    expect(server.created).toEqual([{ path: 'Plan (web).md', text: 'mine\n' }]);
    expect(await store.all()).toEqual([]);
  });

  it('keeps the journal when the session ends', async () => {
    const notes = await load();
    await notes.readNote('/Notes/Plan.md');
    server.refuse = 401;
    await expect(notes.saveFile('/Notes/Plan.md', 'mine\n', true)).rejects.toThrow();
    expect(server.created).toEqual([]);
    expect((await store.all())[0].latest).toBe('mine\n');
  });
});
