/**
 * Small JSON files for settings and app state: in the app data dir, or a
 * workspace's `.solstice/`. See `index.ts`.
 */
export { load, type Store } from '@tauri-apps/plugin-store';
export { mkdir } from '@tauri-apps/plugin-fs';
