/**
 * The desktop app's updates: Tauri's updater, against the `latest.json` that
 * each published GitHub release carries (`plugins.updater` in
 * tauri.conf.json). A phone updates through its store and the web app with
 * its server, so off the desktop there's never an update.
 */
import { getVersion } from '@tauri-apps/api/app';
import { relaunch } from '@tauri-apps/plugin-process';
import { check } from '@tauri-apps/plugin-updater';
import { inTauri } from './index';
import { can } from './platform';

export interface AvailableUpdate {
  version: string;
  /** The release's notes, as written on GitHub. */
  notes: string;
  /** Download, install and restart into it. `progress` is 0-1, or null while the size is unknown. */
  install(onProgress: (progress: number | null) => void): Promise<void>;
}

/** This build's version, or null in a browser. */
export async function appVersion(): Promise<string | null> {
  return inTauri ? getVersion() : null;
}

/** A newer version than this one, if the latest release has one. Throws when the check fails. */
export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  if (!can.updates) return null;
  const update = await check();
  if (!update) return null;
  return {
    version: update.version,
    notes: update.body ?? '',
    async install(onProgress) {
      let total: number | undefined;
      let received = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          total = event.data.contentLength;
          onProgress(total ? 0 : null);
        } else if (event.event === 'Progress') {
          received += event.data.chunkLength;
          onProgress(total ? Math.min(received / total, 1) : null);
        }
      });
      // Windows has quit by now, for the installer; macOS and Linux restart here.
      await relaunch();
    },
  };
}
