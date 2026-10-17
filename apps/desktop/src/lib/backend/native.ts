/**
 * The iOS app's native views: a PDF (later a drawing) drawn by the system
 * under the webview, which is see-through where a `NativeSurface` leaves a
 * hole. The Swift side is `src-tauri/plugins/native`. Only where
 * `can.nativeViews`.
 */
import { addPluginListener, invoke } from '@tauri-apps/api/core';
import type { CommandId, PageSpec, ResolvedMenu } from '@/bindings';

export type SurfaceKind = 'pdf' | 'drawing';

export type SurfaceEvent = {
  id: string;
  type: 'saved' | 'dirty' | 'error' | 'editing';
  path: string;
  message?: string;
  /** For `editing`: whether a finger draws too (on every surface). */
  on?: boolean;
};

export type Rect = { x: number; y: number; width: number; height: number };

const surface = <T = unknown>(args: Record<string, unknown>) =>
  invoke<T>('plugin:solstice-native|surface', args).catch((error: unknown) => {
    console.error('[native] surface', args.op, error);
    return null;
  });
const host = (args: Record<string, unknown>) =>
  invoke('plugin:solstice-native|host', args).catch((error: unknown) =>
    console.error('[native] host', args.op, error),
  );

export const nativeSurfaces = {
  open: (id: string, kind: SurfaceKind, path: string) => surface({ op: 'open', id, kind, path }),
  /** Where it is, in CSS pixels from the viewport, and whether it shows. */
  place: (id: string, rect: Rect, visible: boolean) => surface({ op: 'frame', id, ...rect, visible }),
  reload: (id: string) => surface({ op: 'reload', id }),
  close: (id: string) => surface({ op: 'close', id }),
  /** Finger drawing, on every surface (the Pencil always draws). */
  edit: (id: string, on: boolean) => surface({ op: 'edit', id, on }),
  /** Highlights the matches and shows the first; an empty query clears them. */
  find: (id: string, query: string, caseSensitive: boolean, wholeWord: boolean) =>
    surface<{ count: number; active: number }>({ op: 'find', id, query, caseSensitive, wholeWord }),
  findStep: (id: string, direction: 1 | -1) =>
    surface<{ active: number }>({ op: 'findStep', id, direction }),
  /**
   * A web menu or dialog is open (the webview takes every touch), and where
   * web content sits over the surfaces (it takes the touches there).
   */
  overlays: (modal: boolean, rects: Rect[]) => host({ op: 'overlays', modal, rects }),
  /**
   * Web text took focus, or lost it: typing wins, so the surface in front
   * lets the tool picker go until the Pencil touches it again.
   */
  webFocus: (on: boolean) => host({ op: 'webFocus', on }),
  /**
   * How ink behaves: scratching out with the Pencil erases (`ink.scratchOut`),
   * and pages and drawings are shown on dark paper (`ink.darkPaper`).
   */
  ink: (options: { scratchOut?: boolean; darkPaper?: boolean }) => host({ op: 'ink', ...options }),
  /** A new notebook: an A4 PDF with one page of `template`. */
  createNotebook: (path: string, template: string) =>
    invoke('plugin:solstice-native|host', { op: 'notebook', path, template }),
  /** The theme's background, painted behind the see-through webview. */
  background: (rgb: number[]) => host({ op: 'background', rgb }),
  listen: (handler: (event: SurfaceEvent) => void) =>
    addPluginListener('solstice-native', 'surface', handler),
};

/**
 * Getting files out (`Share.swift`): the share sheet, the Files picker for a
 * copy, and an export page printed to a PDF. Failures reach the caller.
 */
export const nativeShare = {
  /** The share sheet; on an iPad a popover from `anchor` (CSS pixels). */
  share: (paths: string[], anchor: Rect | null) =>
    invoke<void>('plugin:solstice-native|host', { op: 'share', paths, anchor }),
  /** Save to Files: whether a copy was saved. */
  exportFiles: (paths: string[]) =>
    invoke<{ saved: boolean }>('plugin:solstice-native|host', { op: 'exportFiles', paths }).then((r) => r.saved),
  pdf: (html: string, page: PageSpec, path: string) =>
    invoke<void>('plugin:solstice-native|host', { op: 'pdf', html, page, path }),
};

/**
 * The iPad's menu bar, built natively from the same menus as the Mac's
 * (`get_menu_layout`); its items come back as commands to run.
 */
export const nativeMenu = {
  set: (menus: ResolvedMenu[]) => host({ op: 'menu', menus }),
  listen: (handler: (id: CommandId) => void) =>
    addPluginListener<{ id: CommandId }>('solstice-native', 'menu', (event) => handler(event.id)),
};

/**
 * The on-screen keyboard (`WebviewFit`): how much of the app's bottom a
 * docked keyboard covers, in CSS pixels, and how long it takes to get there;
 * and whether a hardware keyboard is attached. The webview keeps its size;
 * the page makes room where it's typed in.
 */
export type KeyboardEvent = { inset: number; docked: boolean; shown?: boolean; duration: number; hardware?: boolean };

export const nativeKeyboard = {
  listen: (handler: (event: KeyboardEvent) => void) =>
    addPluginListener<KeyboardEvent>('solstice-native', 'keyboard', handler),
  /**
   * A finger is about to type: iOS stops expecting the Pencil, which it does
   * for some seconds after Scribble, keeping the keyboard down meanwhile.
   */
  expectTyping: () => host({ op: 'expectTyping' }),
};
