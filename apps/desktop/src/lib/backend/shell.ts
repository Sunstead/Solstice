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
import { isDesktop } from './index';
import * as web from './web/shell';

export const openUrl: typeof tauriOpenUrl = isDesktop ? tauriOpenUrl : web.openUrl;
export const openPath: typeof tauriOpenPath = isDesktop ? tauriOpenPath : web.openPath;
export const revealItemInDir: typeof tauriReveal = isDesktop ? tauriReveal : web.revealItemInDir;
export const message: typeof tauriMessage = isDesktop ? tauriMessage : web.message;
export const open: typeof tauriOpen = isDesktop ? tauriOpen : (web.open as typeof tauriOpen);
export const platform: typeof tauriPlatform = isDesktop ? tauriPlatform : web.platform;
export const getCurrent: typeof tauriGetCurrent = isDesktop ? tauriGetCurrent : web.getCurrent;
export const onOpenUrl: typeof tauriOnOpenUrl = isDesktop ? tauriOnOpenUrl : web.onOpenUrl;
export const assetUrl: typeof convertFileSrc = isDesktop ? convertFileSrc : web.assetUrl;
