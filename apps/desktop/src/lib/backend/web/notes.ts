/**
 * Reading and saving files on the web, through the journal.
 *
 * A note is read with a `base` and saved against it, and the server merges
 * the save into whatever other devices did since. Saves to one file go one
 * at a time: a save whose reply was lost is sent again as it was, with the
 * same id, before anything newer. Sent from the old base, a newer save would
 * carry the lost one's edit with it, and the server would apply it twice.
 */
import { ApiError, apiJson, api } from './api';
import { defaultStore, journalKey, type Attempt, type JournalEntry, type JournalStore } from './journal';
import { connected, fsChanged, refresh, resolve, rootOf, vaultUrl, type Vault } from './vault';

interface NoteReply {
  path: string;
  text: string;
  base: string;
}

let journal: JournalStore = defaultStore();

/** For tests. */
export function useJournal(store: JournalStore) {
  journal = store;
}

/** The base of what each open note's editor holds. */
const bases = new Map<string, string>();

const locks = new Map<string, Promise<unknown>>();

function exclusive<T>(key: string, run: () => Promise<T>): Promise<T> {
  const next = (locks.get(key) ?? Promise.resolve()).catch(() => {}).then(run);
  locks.set(key, next);
  void next
    .catch(() => {})
    .finally(() => {
      if (locks.get(key) === next) locks.delete(key);
    });
  return next;
}

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/** The server can't take this write, now or later: no point sending it again. */
const refused = (error: unknown) =>
  error instanceof ApiError && [400, 404, 409, 410, 422].includes(error.status);

/**
 * A write made as the page hides has to outlive it. `keepalive` caps all such
 * requests at 64 KB together, and one over it fails outright, so only small
 * ones ask.
 */
const outlive = (body: string) =>
  typeof document !== 'undefined' && document.visibilityState === 'hidden' && body.length < 32_000;

export async function readNote(path: string): Promise<string> {
  const { vault, rel } = await resolve(path);
  const key = journalKey(vault.id, rel);
  const note = await apiJson<NoteReply>(vaultUrl(vault, 'notes', rel));
  const pending = await journal.get(key);
  if (!pending) {
    bases.set(path, note.base);
    return note.text;
  }
  // Edits from before a reload, or still on their way: open what they make.
  try {
    await exclusive(key, () => drain(path, vault, rel, key));
    const merged = await apiJson<NoteReply>(vaultUrl(vault, 'notes', rel));
    bases.set(path, merged.base);
    return merged.text;
  } catch {
    const left = await journal.get(key);
    if (!left) {
      bases.set(path, note.base);
      return note.text;
    }
    bases.set(path, left.sent?.base ?? left.base ?? note.base);
    return left.latest;
  }
}

/** Journals `text` at once, then sends it (and anything still unsent) in turn. */
export async function saveFile(path: string, text: string, note: boolean): Promise<void> {
  const { vault, rel } = await resolve(path);
  const key = journalKey(vault.id, rel);
  await journal.update(key, (entry) => ({
    key,
    vault: vault.id,
    rel,
    note,
    latest: text,
    base: entry?.base ?? bases.get(path) ?? null,
    sent: entry?.sent ?? null,
    at: Date.now(),
  }));
  await exclusive(key, () => drain(path, vault, rel, key));
}

async function drain(path: string, vault: Vault, rel: string, key: string): Promise<void> {
  for (;;) {
    const entry = await journal.get(key);
    if (!entry) return;
    const attempt: Attempt = entry.sent ?? {
      text: entry.latest,
      base: bases.get(path) ?? entry.base,
      id: newId(),
    };
    if (!entry.sent) await journal.update(key, (e) => (e ? { ...e, sent: attempt } : e));

    let landedBase: string | null = null;
    try {
      if (entry.note) {
        const body = JSON.stringify({ text: attempt.text, base: attempt.base, save_id: attempt.id });
        const reply = await apiJson<NoteReply>(vaultUrl(vault, 'notes', rel), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: outlive(body),
        });
        landedBase = reply.base;
        bases.set(path, reply.base);
      } else {
        await api(vaultUrl(vault, 'files', rel), {
          method: 'PUT',
          body: attempt.text,
          keepalive: outlive(attempt.text),
        });
        await refresh();
      }
    } catch (error) {
      if (!refused(error)) throw error;
      await keepAside(path, vault, rel, key, entry, attempt);
      return;
    }

    // Landed. Done, unless something newer was journaled meanwhile.
    const left = await journal.update(key, (e) => {
      if (!e || e.latest === attempt.text) return undefined;
      return { ...e, base: landedBase ?? e.base, sent: null };
    });
    if (!left) return;
  }
}

/**
 * The server won't take it (its history was rebuilt, the note is gone): keep
 * the text beside it as `<name> (web).md`, the way sync keeps a device's
 * version, and let the editor load what's there.
 */
async function keepAside(path: string, vault: Vault, rel: string, key: string, entry: JournalEntry, attempt: Attempt) {
  const text = entry.latest === attempt.text ? attempt.text : entry.latest;
  const dot = rel.lastIndexOf('.');
  const copy = dot > rel.lastIndexOf('/') ? `${rel.slice(0, dot)} (web)${rel.slice(dot)}` : `${rel} (web)`;
  try {
    if (entry.note) {
      await apiJson(vaultUrl(vault, 'ops'), { method: 'POST', json: { op: 'create_note', path: copy, text } });
    } else {
      await api(`${vaultUrl(vault, 'files', copy)}?new=1`, { method: 'PUT', body: text });
    }
    await refresh();
  } catch {
    // The vault itself is gone; there's nowhere to keep it.
  }
  await journal.update(key, () => undefined);
  bases.delete(path);
  fsChanged.emit({ root: rootOf(vault), changes: [{ kind: 'Modified', path, from: null, entry: null }] });
}

/** After a rename: the journal and the base follow the note. */
export async function moved(from: string, to: string) {
  const base = bases.get(from);
  if (base) bases.set(to, base);
  const a = await resolve(from);
  const b = await resolve(to);
  const fromKey = journalKey(a.vault.id, a.rel);
  const entry = await journal.get(fromKey);
  if (!entry) return;
  const toKey = journalKey(b.vault.id, b.rel);
  await journal.update(toKey, () => ({ ...entry, key: toKey, vault: b.vault.id, rel: b.rel }));
  await journal.update(fromKey, () => undefined);
}

export function forgetBase(path: string) {
  bases.delete(path);
}

/** Sends what a vault has journaled: notes edited before a reload, or offline. */
async function replay(vault: Vault) {
  const entries = (await journal.all()).filter((e) => e.vault === vault.id);
  for (const e of entries) {
    const path = `${rootOf(vault)}/${e.rel}`;
    await exclusive(e.key, () => drain(path, vault, e.rel, e.key)).catch(() => {});
  }
}

void connected.listen(({ payload }) => void replay(payload));
