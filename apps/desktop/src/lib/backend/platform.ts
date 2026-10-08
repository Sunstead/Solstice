/**
 * What the app is running in, and what that lets it do. Ask for the ability
 * (`can.pickFolders`), not the shell, so the iOS app is a matter of what's
 * set here.
 */
import { platform } from '@tauri-apps/plugin-os';
import { inTauri } from './index';

/** The desktop app, Tauri on a phone or tablet, or a browser. */
export type Shell = 'desktop' | 'mobile' | 'web';

export const shell: Shell = !inTauri
  ? 'web'
  : platform() === 'ios' || platform() === 'android'
    ? 'mobile'
    : 'desktop';

export const can = {
  /** Workspaces are folders on this device; on the web they're vaults on the server. */
  localFolders: shell !== 'web',
  /** The system's folder picker: any folder as a workspace, or where a new one goes. */
  pickFolders: shell === 'desktop',
  /** A window of its own to draw: controls, drag regions, fullscreen. */
  windowChrome: shell === 'desktop',
  /** A file manager to show files in, and default apps to open them with. */
  fileManager: shell === 'desktop',
  /** Installed fonts, and folders of user themes. */
  systemFonts: shell === 'desktop',
  themeFolders: shell === 'desktop',
  /** Linking folders to a sync server; the web app is the server's own. */
  syncSettings: shell !== 'web',
} as const;
