import { create } from 'zustand';

interface Anchor {
  path: string | null;
  heading: string | null;
  block: string | null;
}

/** A heading or block to show once the note at `path` is open: a link's `#…`. */
export const useAnchorRequest = create<Anchor>(() => ({ path: null, heading: null, block: null }));

export function requestAnchor(path: string, heading: string | null, block: string | null) {
  useAnchorRequest.setState({ path, heading, block });
}

export function clearAnchor() {
  useAnchorRequest.setState({ path: null, heading: null, block: null });
}
