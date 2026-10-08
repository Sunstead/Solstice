/**
 * Writes the server hasn't confirmed, kept in IndexedDB so a lost signal or
 * iOS closing the page never loses one. One entry per file: the newest text,
 * and the attempt in flight, if any, kept exactly so it can be sent again.
 */

export interface Attempt {
  text: string;
  base: string | null;
  /** The server applies a note save with a given id once (`save_id`). */
  id: string;
}

export interface JournalEntry {
  /** `<vault id>/<vault path>` */
  key: string;
  vault: string;
  rel: string;
  /** A note, saved against a base; otherwise a whole file, last writer wins. */
  note: boolean;
  /** What the editor last held. */
  latest: string;
  /** The base `latest` was edited against, for after a reload. */
  base: string | null;
  /** Sent, with no reply yet: it may have landed. */
  sent: Attempt | null;
  at: number;
}

export interface JournalStore {
  get(key: string): Promise<JournalEntry | undefined>;
  all(): Promise<JournalEntry[]>;
  /** Reads and writes one entry atomically: `undefined` deletes it. */
  update(
    key: string,
    change: (entry: JournalEntry | undefined) => JournalEntry | undefined,
  ): Promise<JournalEntry | undefined>;
}

export const journalKey = (vault: string, rel: string) => `${vault}/${rel}`;

export function memoryStore(): JournalStore {
  const entries = new Map<string, JournalEntry>();
  return {
    get: async (key) => entries.get(key),
    all: async () => [...entries.values()],
    update: async (key, change) => {
      const next = change(entries.get(key));
      if (next) entries.set(key, next);
      else entries.delete(key);
      return next;
    },
  };
}

const DB = 'solstice';
const STORE = 'journal';

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function indexedDbStore(): JournalStore {
  let db: Promise<IDBDatabase> | null = null;
  const open = () =>
    (db ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'key' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
  const tx = async (mode: IDBTransactionMode) =>
    (await open()).transaction(STORE, mode).objectStore(STORE);

  return {
    get: async (key) => request<JournalEntry | undefined>((await tx('readonly')).get(key)),
    all: async () => request<JournalEntry[]>((await tx('readonly')).getAll()),
    update: async (key, change) => {
      const store = await tx('readwrite');
      // The read and the write share one transaction, so nothing lands between.
      const next = change(await request<JournalEntry | undefined>(store.get(key)));
      if (next) await request(store.put(next));
      else await request(store.delete(key));
      return next;
    },
  };
}

/**
 * IndexedDB where it opens; memory where it can't (some private windows),
 * which still covers a lost signal, just not a closed page.
 */
export function defaultStore(): JournalStore {
  if (typeof indexedDB === 'undefined') return memoryStore();
  const idb = indexedDbStore();
  let fallback: JournalStore | null = null;
  const pick = async <T>(run: (s: JournalStore) => Promise<T>): Promise<T> => {
    if (fallback) return run(fallback);
    try {
      return await run(idb);
    } catch {
      fallback = memoryStore();
      return run(fallback);
    }
  };
  return {
    get: (key) => pick((s) => s.get(key)),
    all: () => pick((s) => s.all()),
    update: (key, change) => pick((s) => s.update(key, change)),
  };
}
