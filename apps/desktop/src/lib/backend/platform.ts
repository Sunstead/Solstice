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
  /**
   * A File/Edit/View menu. iOS has none: everything is in the app's own UI
   * (the tab's file actions, the sidebar, the keyboard bar).
   */
  appMenu: shell !== 'mobile',
  /** Linking folders to a sync server; the web app is the server's own. */
  syncSettings: shell !== 'web',
  /**
   * Updating itself from GitHub releases. A phone updates through its store,
   * the web app with its server.
   */
  updates: shell === 'desktop',
} as const;

/** What to call the machine the app is on, in sentences ("on this computer"). */
export const deviceNoun = shell === 'mobile' ? 'device' : 'computer';
