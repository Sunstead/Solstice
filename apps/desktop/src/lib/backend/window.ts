/**
 * The app's window: its controls, size and focus. In the browser it's the
 * page (`web/window.ts`). See `index.ts`.
 */
import { getCurrentWindow as tauriWindow, type Window } from '@tauri-apps/api/window';
import { inTauri } from './index';
import { browserWindow } from './web/window';

export type { Window };

export const getCurrentWindow: typeof tauriWindow = inTauri
  ? tauriWindow
  : () => browserWindow as unknown as Window;
