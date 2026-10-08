// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Result = { status: 'ok'; data: null } | { status: 'error'; error: string };

const writes: { text: string; resolve: (r: Result) => void }[] = [];

vi.mock('@/lib/backend', () => ({
  commands: {
    writeFile: (_path: string, text: string) =>
      new Promise<Result>((resolve) => writes.push({ text, resolve })),
    syncEditorOpened: async () => ({ status: 'ok', data: null }),
  },
  events: { syncChanged: { listen: async () => () => {} } },
}));
vi.mock('@/lib/settings/store', () => ({
  getSetting: (key: string) => (key === 'editor.autosave' ? 'idle' : 100),
  subscribeToSetting: () => () => {},
}));
vi.mock('@/lib/embed/source', () => ({ noteEmbedSourceWritten: () => {} }));

const { createAutosaver } = await import('./autosave');
const { useSaveFailures } = await import('./stores/save-status');

const ok: Result = { status: 'ok', data: null };
const offline: Result = { status: 'error', error: 'offline' };
const failure = () => useSaveFailures.getState().failed['/n.md'] ?? null;

/** Lets a write's `.then` run. */
const settle = () => vi.advanceTimersByTimeAsync(0);

describe('createAutosaver', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    writes.length = 0;
    useSaveFailures.setState({ failed: {} });
  });
  afterEach(() => vi.useRealTimers());

  const edit = (saver: ReturnType<typeof createAutosaver>, text: string) => {
    saver.markDirty();
    saver.schedule(text);
  };

  it('keeps a failed edit and retries it until it lands', async () => {
    const saver = createAutosaver('/n.md', 'a');
    edit(saver, 'ab');
    await vi.advanceTimersByTimeAsync(100);
    writes[0].resolve(offline);
    await settle();
    expect(failure()).toBe('offline');
    expect(saver.isDirty()).toBe(true);

    await vi.advanceTimersByTimeAsync(1000);
    expect(writes[1].text).toBe('ab');
    writes[1].resolve(ok);
    await settle();
    expect(failure()).toBeNull();
    expect(saver.isDirty()).toBe(false);
    saver.dispose();
  });

  it('retries with the newest edit, not the one that failed', async () => {
    const saver = createAutosaver('/n.md', 'a');
    edit(saver, 'ab');
    await vi.advanceTimersByTimeAsync(100);
    writes[0].resolve(offline);
    await settle();
    edit(saver, 'abc');
    await vi.advanceTimersByTimeAsync(100);
    expect(writes.map((w) => w.text)).toEqual(['ab', 'abc']);
    writes[1].resolve(ok);
    await settle();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(writes).toHaveLength(2);
    saver.dispose();
  });

  it("doesn't bring back an older write that failed after a newer one landed", async () => {
    vi.useRealTimers();
    const saver = createAutosaver('/n.md', 'a');
    edit(saver, 'ab');
    saver.flush();
    edit(saver, 'abc');
    saver.flush();
    writes[1].resolve(ok);
    writes[0].resolve(offline);
    await new Promise((r) => setTimeout(r, 0));
    expect(failure()).toBeNull();
    expect(saver.isDirty()).toBe(false);
    saver.dispose();
  });

  it('retries at once when the network comes back', async () => {
    const saver = createAutosaver('/n.md', 'a');
    edit(saver, 'ab');
    await vi.advanceTimersByTimeAsync(100);
    writes[0].resolve(offline);
    await settle();
    window.dispatchEvent(new Event('online'));
    expect(writes).toHaveLength(2);
    saver.dispose();
  });

  it('flushes when the page is hidden', async () => {
    const saver = createAutosaver('/n.md', 'a');
    edit(saver, 'ab');
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(writes.map((w) => w.text)).toEqual(['ab']);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    saver.dispose();
  });

  it('stops retrying once disposed', async () => {
    const saver = createAutosaver('/n.md', 'a');
    edit(saver, 'ab');
    await vi.advanceTimersByTimeAsync(100);
    writes[0].resolve(offline);
    await settle();
    saver.dispose();
    expect(failure()).toBeNull();
    // dispose's own flush is the last attempt.
    writes[writes.length - 1].resolve(offline);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(writes).toHaveLength(2);
    expect(failure()).toBeNull();
  });
});
