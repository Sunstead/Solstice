import { create } from 'zustand';

/** A pending "pick a file" request, answered by the picker in the root layout. */
export const useNotePicker = create<{ resolve: ((path: string | null) => void) | null }>(() => ({
  resolve: null,
}));

/** Quick open's list, choosing instead of opening: the path, or null if dismissed. */
export function pickFile(): Promise<string | null> {
  answerPick(null);
  return new Promise((resolve) => useNotePicker.setState({ resolve }));
}

export function answerPick(path: string | null) {
  const { resolve } = useNotePicker.getState();
  if (!resolve) return;
  useNotePicker.setState({ resolve: null });
  resolve(path);
}
