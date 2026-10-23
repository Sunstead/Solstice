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
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  commands as tauriCommands,
  events as tauriEvents,
  type FileSystemChanged,
  type FlushRequested,
  type KeymapChanged,
  type MenuCommand,
  type StoreChanged,
  type SyncChanged,
  type TabAdopted,
  type TabDrag,
  type TabDragEnded,
  type TabSent,
  type TreeMetaChanged,
  type WindowsChanged,
} from '@/bindings';
import { keymapChanged, webCommands } from './web/commands';
import { Emitter } from './web/emitter';
import { fsChanged, syncChanged, treeMetaChanged } from './web/vault';

/**
 * Whether the app runs in Tauri: the desktop app, or the mobile one. What
 * that allows is in `platform.ts`.
 */
export const inTauri = isTauri();

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
  treeMetaChanged: EventSource<TreeMetaChanged>;
  // Between the desktop app's windows (`can.multiWindow`).
  tabAdopted: EventSource<TabAdopted>;
  tabDrag: EventSource<TabDrag>;
  tabDragEnded: EventSource<TabDragEnded>;
  tabSent: EventSource<TabSent>;
  windowsChanged: EventSource<WindowsChanged>;
  storeChanged: EventSource<StoreChanged>;
  flushRequested: EventSource<FlushRequested>;
}

export const commands: Commands = inTauri ? tauriCommands : webCommands;
/**
 * Events one window is sent (`emit_to` it, or to the others) are listened
 * for on that window: a global listener hears every window's, so a menu
 * command would run in all of them.
 */
function tauriEventsFor(): Events {
  const own = getCurrentWindow();
  return {
    fileSystemChanged: tauriEvents.fileSystemChanged,
    keymapChanged: tauriEvents.keymapChanged,
    syncChanged: tauriEvents.syncChanged,
    treeMetaChanged: tauriEvents.treeMetaChanged,
    windowsChanged: tauriEvents.windowsChanged,
    menuCommand: tauriEvents.menuCommand(own),
    tabAdopted: tauriEvents.tabAdopted(own),
    tabDrag: tauriEvents.tabDrag(own),
    tabDragEnded: tauriEvents.tabDragEnded(own),
    tabSent: tauriEvents.tabSent(own),
    storeChanged: tauriEvents.storeChanged(own),
    flushRequested: tauriEvents.flushRequested(own),
  };
}

export const events: Events = inTauri
  ? tauriEventsFor()
  : {
      fileSystemChanged: fsChanged,
      keymapChanged,
      // The web app has no native menu to send these.
      menuCommand: new Emitter<MenuCommand>(),
      syncChanged,
      treeMetaChanged,
      // A browser tab is one window.
      tabAdopted: new Emitter<TabAdopted>(),
      tabDrag: new Emitter<TabDrag>(),
      tabDragEnded: new Emitter<TabDragEnded>(),
      tabSent: new Emitter<TabSent>(),
      windowsChanged: new Emitter<WindowsChanged>(),
      storeChanged: new Emitter<StoreChanged>(),
      flushRequested: new Emitter<FlushRequested>(),
    };

/** A command's data, or a throw with its error, as a raw `invoke` gives. */
export async function unwrap<T, E>(
  result: Promise<{ status: 'ok'; data: T } | { status: 'error'; error: E }>,
): Promise<T> {
  const r = await result;
  if (r.status === 'error') throw r.error;
  return r.data;
}
