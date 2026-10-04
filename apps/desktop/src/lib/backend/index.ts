/**
 * The one place the app talks to what runs it. Everything that reaches the
 * Tauri runtime (commands, events, plugins, the window) goes through here,
 * so the same UI runs on another backend: the web app, against the Solstice
 * Sync server it's served from (`web/`). An ESLint rule keeps
 * `@tauri-apps/*` and the generated `@/bindings` (values; its types are fine
 * anywhere) inside this folder.
 *
 * In the desktop shell these are the Tauri originals, so the desktop app
 * behaves exactly as it did when it called Tauri directly.
 */
import { isTauri } from '@tauri-apps/api/core';
import {
  commands as tauriCommands,
  events as tauriEvents,
  type FileSystemChanged,
  type KeymapChanged,
  type MenuCommand,
  type SyncChanged,
} from '@/bindings';
import { keymapChanged, webCommands } from './web/commands';
import { Emitter } from './web/emitter';
import { fsChanged, syncChanged } from './web/vault';

/** Whether the app is running in the desktop shell. */
export const isDesktop = isTauri();

/** Every backend command, with the generated bindings' signatures. */
export type Commands = typeof tauriCommands;

/** An event the backend sends, as the app listens to it. */
export interface EventSource<T> {
  listen(handler: (event: { payload: T }) => void): Promise<() => void>;
}

export interface Events {
  fileSystemChanged: EventSource<FileSystemChanged>;
  keymapChanged: EventSource<KeymapChanged>;
  menuCommand: EventSource<MenuCommand>;
  syncChanged: EventSource<SyncChanged>;
}

export const commands: Commands = isDesktop ? tauriCommands : webCommands;
export const events: Events = isDesktop
  ? tauriEvents
  : {
      fileSystemChanged: fsChanged,
      keymapChanged,
      // The web app has no native menu to send these.
      menuCommand: new Emitter<MenuCommand>(),
      syncChanged,
    };

/** A command's data, or a throw with its error, as a raw `invoke` gives. */
export async function unwrap<T, E>(
  result: Promise<{ status: 'ok'; data: T } | { status: 'error'; error: E }>,
): Promise<T> {
  const r = await result;
  if (r.status === 'error') throw r.error;
  return r.data;
}
