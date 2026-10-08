/**
 * What the app asks of the operating system: opening things outside it,
 * file and message dialogs, the platform, asset URLs, deep links. In the
 * browser, `web/shell.ts` stands in. See `index.ts` for why these live here.
 */
import { convertFileSrc } from '@tauri-apps/api/core';
import { getCurrent as tauriGetCurrent, onOpenUrl as tauriOnOpenUrl } from '@tauri-apps/plugin-deep-link';
import { message as tauriMessage, open as tauriOpen } from '@tauri-apps/plugin-dialog';
import {
  openPath as tauriOpenPath,
  openUrl as tauriOpenUrl,
  revealItemInDir as tauriReveal,
} from '@tauri-apps/plugin-opener';
import { platform as tauriPlatform } from '@tauri-apps/plugin-os';
import { inTauri } from './index';
import * as web from './web/shell';

export const openUrl: typeof tauriOpenUrl = inTauri ? tauriOpenUrl : web.openUrl;
export const openPath: typeof tauriOpenPath = inTauri ? tauriOpenPath : web.openPath;
export const revealItemInDir: typeof tauriReveal = inTauri ? tauriReveal : web.revealItemInDir;
export const message: typeof tauriMessage = inTauri ? tauriMessage : web.message;
export const open: typeof tauriOpen = inTauri ? tauriOpen : (web.open as typeof tauriOpen);
export const platform: typeof tauriPlatform = inTauri ? tauriPlatform : web.platform;
export const getCurrent: typeof tauriGetCurrent = inTauri ? tauriGetCurrent : web.getCurrent;
export const onOpenUrl: typeof tauriOnOpenUrl = inTauri ? tauriOnOpenUrl : web.onOpenUrl;
export const assetUrl: typeof convertFileSrc = inTauri ? convertFileSrc : web.assetUrl;
