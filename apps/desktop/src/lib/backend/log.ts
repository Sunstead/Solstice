/**
 * The app's log: in the desktop shell the terminal and the log folder
 * (tauri-plugin-log), in a browser the console.
 */
import { error as tauriError, info as tauriInfo, warn as tauriWarn } from '@tauri-apps/plugin-log';
import { inTauri } from './index';

export const log = inTauri
  ? {
      info: (message: string) => void tauriInfo(message),
      warn: (message: string) => void tauriWarn(message),
      error: (message: string) => void tauriError(message),
    }
  : {
      info: (message: string) => console.info(message),
      warn: (message: string) => console.warn(message),
      error: (message: string) => console.error(message),
    };
