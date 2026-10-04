/**
 * Small JSON files for settings and app state: in the app data dir, or a
 * workspace's `.solstice/`. In the browser they're kept on the server
 * (`web/store.ts`). See `index.ts`.
 */
import { mkdir as tauriMkdir } from '@tauri-apps/plugin-fs';
import { load as tauriLoad, type Store } from '@tauri-apps/plugin-store';
import { isDesktop } from './index';
import { WebStore } from './web/store';

export type { Store };

export const load: typeof tauriLoad = isDesktop
  ? tauriLoad
  : (path) => WebStore.load(path) as unknown as Promise<Store>;

/** The server keeps no folders for settings. */
export const mkdir: typeof tauriMkdir = isDesktop ? tauriMkdir : async () => {};
