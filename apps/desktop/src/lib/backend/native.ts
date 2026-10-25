/**
 * The iOS app's native views: a PDF (later a drawing) drawn by the system
 * under the webview, which is see-through where a `NativeSurface` leaves a
 * hole. The Swift side is `src-tauri/plugins/native`. Only where
 * `can.nativeViews`.
 */
import { addPluginListener, invoke } from '@tauri-apps/api/core';
import type { CommandId, PageSpec, ResolvedMenu } from '@/bindings';
import type { InsertItem, InsertShape } from '@/lib/ink/insert';
import type { PencilGesture, toNative } from '@/lib/ink/toolbox';

export type SurfaceKind = 'pdf' | 'drawing' | 'image';

export type SurfaceEvent = {
  id: string;
  type: 'saved' | 'dirty' | 'error';
  path: string;
  message?: string;
  /** A `saved` that was the last before the file was left: sync it at once. */
  final?: boolean;
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
  /**
   * Where it is, in CSS pixels from the viewport, and whether it shows.
   * `hold`: a Zen switch's new size, its content kept where it was
   * (`beginSurfaceEase`).
   */
  place: (id: string, rect: Rect, visible: boolean, rgb?: number[] | null, hold?: boolean) =>
    surface({ op: 'frame', id, ...rect, visible, rgb: rgb ?? undefined, ease: hold ? 'hold' : undefined }),
  /** Eases held content (`play`), or puts it where it belongs (`end`). */
  ease: (id: string, phase: 'play' | 'end') => surface({ op: 'ease', id, ease: phase }),
  reload: (id: string) => surface({ op: 'reload', id }),
  close: (id: string) => surface({ op: 'close', id }),
  /** Highlights the matches and shows the first; an empty query clears them. */
  find: (id: string, query: string, caseSensitive: boolean, wholeWord: boolean) =>
    surface<{ count: number; active: number }>({ op: 'find', id, query, caseSensitive, wholeWord }),
  findStep: (id: string, direction: 1 | -1) =>
    surface<{ active: number }>({ op: 'findStep', id, direction }),
  /** Makes the first match on `page` (zero-based) or after it current, handwriting or text first as `ink` says. */
  findPage: (id: string, page: number, ink: boolean) =>
    surface<{ active: number }>({ op: 'findPage', id, page, ink }),
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
   * pages and drawings are shown on dark paper (`ink.darkPaper`), and the
   * theme's ground dark paper is painted with (`paper`, `--background` as
   * sRGB, so the native paper matches the app around it).
   */
  ink: (options: { scratchOut?: boolean; darkPaper?: boolean; paper?: number[] }) =>
    host({ op: 'ink', ...options }),
  /** A new notebook: an A4 PDF with one page of `template`. */
  createNotebook: (path: string, template: string) =>
    invoke('plugin:solstice-native|host', { op: 'notebook', path, template }),
  /** The theme's background, painted behind the see-through webview. */
  background: (rgb: number[]) => host({ op: 'background', rgb }),
  listen: (handler: (event: SurfaceEvent) => void) =>
    addPluginListener('solstice-native', 'surface', handler),
};

/** What the native side says about the tools (`Ink.swift`). */
export type InkEvent =
  /**
   * A double tap or squeeze, with what Settings asks of it, where the Pencil
   * hovers (CSS pixels) and which way its barrel leans (radians, as `atan2` on screen).
   */
  | ({ type: 'pencil'; x?: number; y?: number; azimuth?: number } & PencilGesture)
  /** Whether the canvas in front can undo or redo. */
  | { type: 'undo'; canUndo: boolean; canRedo: boolean }
  /** Apple's colour picker chose a colour; `final` once it settles. */
  | { type: 'color'; color: string; opacity: number; final: boolean };

/**
 * The ink tools (`lib/ink/toolbox.ts`), applied to every canvas: the ribbon
 * and squeeze palette are the web's, the drawing is the native side's.
 */
export const nativeInk = {
  setTool: (tool: ReturnType<typeof toNative>) => host({ op: 'tool', tool }),
  setRuler: (on: boolean) => host({ op: 'ruler', on }),
  /** A finger draws too, on every surface (the Pencil always draws). */
  setFingerDraws: (on: boolean) => host({ op: 'fingerDraws', on }),
  undo: () => host({ op: 'undo' }),
  redo: () => host({ op: 'redo' }),
  /** Asks for an `undo` event now. */
  undoState: () => host({ op: 'undoState' }),
  /** Into the canvas in view (`lib/ink/insert.ts`): text, a shape, a line, a loupe, an image, or a PDF page. */
  insert: (item: InsertItem['id'], shape?: InsertShape) => host({ op: 'insert', item, shape }),
  /** The PDF in front's pages: how many, and which is in view. */
  pages: () =>
    invoke<{ count: number; current: number }>('plugin:solstice-native|host', { op: 'pages' }).catch(() => ({
      count: 0,
      current: 0,
    })),
  /** Page `index` with its marks, `width` points across, as a data URL ('' if it can't). */
  thumbnail: (index: number, width: number) =>
    invoke<{ url: string }>('plugin:solstice-native|host', { op: 'thumbnail', index, width })
      .then((r) => r.url)
      .catch(() => ''),
  goToPage: (index: number) => host({ op: 'goToPage', index }),
  /** Puts the pages in `order` (`lib/ink/pages.ts`), deleting those left out. Fails with why. */
  arrangePages: (order: number[]) => invoke<void>('plugin:solstice-native|host', { op: 'arrangePages', order }),
  /** Apple's full colour picker, a popover from `anchor`: answers with `color` events. */
  pickColor: (anchor: Rect) => host({ op: 'pickColor', anchor }),
  listen: (handler: (event: InkEvent) => void) => addPluginListener('solstice-native', 'ink', handler),
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

/**
 * Pencil taps that reached the window but not the page (`PencilTaps.swift`),
 * in CSS pixels.
 */
export const nativePencilTaps = {
  listen: (handler: (tap: { x: number; y: number }) => void) =>
    addPluginListener<{ x: number; y: number }>('solstice-native', 'pencilTap', handler),
};

/**
 * The Taptic Engine (`Haptics.swift`), for gestures that lift, drop or
 * cross a slot. Fire and forget: a missed tick is only a missed tick.
 */
export type HapticKind = 'lift' | 'drop' | 'tick' | 'dismiss' | 'warning';

export const nativeHaptics = {
  /** Wakes the engine before a tick that may follow (a press that may lift). */
  prepare: () => host({ op: 'haptic' }),
  play: (kind: HapticKind) => host({ op: 'haptic', kind }),
};
