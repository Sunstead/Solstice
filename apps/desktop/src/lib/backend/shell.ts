/**
 * What the app asks of the operating system: opening things outside it,
 * file and message dialogs, the platform, asset URLs, deep links. See
 * `index.ts` for why these live here.
 */
export { openPath, openUrl, revealItemInDir } from '@tauri-apps/plugin-opener';
export { message, open } from '@tauri-apps/plugin-dialog';
export { platform } from '@tauri-apps/plugin-os';
export { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link';
export { convertFileSrc as assetUrl } from '@tauri-apps/api/core';
