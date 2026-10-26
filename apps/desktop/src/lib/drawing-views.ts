import { nativeSurfaces } from '@/lib/backend/native';

/** The surface showing each open drawing, for a header outside it (the phone's) to reset its view. */
const shown = new Map<string, string>();

export function showingDrawing(path: string, id: string): () => void {
  shown.set(path, id);
  return () => {
    if (shown.get(path) === id) shown.delete(path);
  };
}

export function recentreDrawing(path: string) {
  const id = shown.get(path);
  if (id) void nativeSurfaces.recentre(id);
}
