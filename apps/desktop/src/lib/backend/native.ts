/**
 * The iOS app's native views: a PDF (later a drawing) drawn by the system
 * under the webview, which is see-through where a `NativeSurface` leaves a
 * hole. The Swift side is `src-tauri/plugins/native`. Only where
 * `can.nativeViews`.
 */
import { addPluginListener, invoke } from '@tauri-apps/api/core';

export type SurfaceKind = 'pdf';

export type SurfaceEvent = {
  id: string;
  type: 'saved' | 'dirty' | 'error' | 'editing';
  path: string;
  message?: string;
  /** For `editing`: whether it's now on. */
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
  /** Markup on a PDF: the tool picker, and a finger drawing too. */
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
  /** The theme's background, painted behind the see-through webview. */
  background: (rgb: number[]) => host({ op: 'background', rgb }),
  listen: (handler: (event: SurfaceEvent) => void) =>
    addPluginListener('solstice-native', 'surface', handler),
};
