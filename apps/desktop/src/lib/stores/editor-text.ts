/**
 * What each open note's editor holds, for switching a tab between the rich
 * editor and source mode. The editor coming in starts from the outgoing one's
 * text, not the file: the last save may still be on its way.
 */
const sources = new Map<string, () => string | null>();
const handoffs = new Map<string, string>();

/** An editor says where its text can be read; returns its unregister. */
export function registerTextSource(path: string, read: () => string | null): () => void {
  sources.set(path, read);
  return () => {
    if (sources.get(path) === read) sources.delete(path);
  };
}

/** Keeps the open editor's text for the one about to replace it. */
export function handOff(path: string) {
  const text = sources.get(path)?.();
  if (text != null) handoffs.set(path, text);
}

/** The text handed over for `path`, once. */
export function takeHandoff(path: string): string | null {
  const text = handoffs.get(path) ?? null;
  handoffs.delete(path);
  return text;
}
