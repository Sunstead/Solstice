import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import {
  defaultToolbox,
  sanitize,
  toolbox,
  type PalettePage,
  type Toolbox,
  type ToolboxAction,
} from '@/lib/ink/toolbox';
import { createScopedStorage } from './scoped-storage';

type InkToolsState = Toolbox & { dispatch: (action: ToolboxAction) => void };

const pick = ({ slots, selected, previous, recents, recentColors, ruler, fingerDraws }: Toolbox): Toolbox => ({
  slots,
  selected,
  previous,
  recents,
  recentColors,
  ruler,
  fingerDraws,
});

/**
 * The ink tools (`lib/ink/toolbox.ts`), one set for every PDF and drawing and
 * across launches: global, like Notes' picker. `lib/ink/native-sync.ts`
 * hands the slot in hand to the native side.
 */
export const useInkTools = create<InkToolsState>()(
  persist<InkToolsState, [], [], Toolbox>(
    (set) => ({
      ...defaultToolbox(),
      dispatch: (action: ToolboxAction) => set((state) => toolbox(state, action)),
    }),
    {
      name: 'ink-tools',
      storage: createJSONStorage(() => createScopedStorage('ink-tools.json', 'global')),
      partialize: pick,
      // Hand-editable on disk, so read through `sanitize`.
      merge: (persisted, current) => ({ ...current, ...sanitize(persisted) }),
    },
  ),
);

export const inkDispatch = (action: ToolboxAction) => useInkTools.getState().dispatch(action);

/** What the ribbon and squeeze palette show that isn't kept: undo, and the palette itself. */
export const useInkUi = create<{
  canUndo: boolean;
  canRedo: boolean;
  /** The squeeze palette, open at `x`, `y` (CSS pixels) on `page`, the Pencil leaning `azimuth`. */
  palette: { x: number; y: number; azimuth?: number; page: PalettePage } | null;
  /**
   * Where the palette was last seen, for when the Pencil's position is not
   * known: a squeeze while it is far off the screen reports no coordinates,
   * and the menu should return to where it was rather than to the centre.
   */
  paletteAt: { x: number; y: number } | null;
  /** The page sheet (`PageSheet`) is open. */
  pages: boolean;
}>(() => ({ canUndo: false, canRedo: false, palette: null, paletteAt: null, pages: false }));
