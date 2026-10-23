/**
 * Which window this is (`windows/` in the Rust side): a full window, with the
 * explorer, or an editor window torn off one, with only its tabs. Asked for
 * once at startup; the desktop app's other shells have one full window.
 */
import { create } from 'zustand';
import type { WindowInit, WindowKind } from '@/bindings';
import { commands } from '@/lib/backend';
import { can } from '@/lib/backend/platform';

type AppWindow = {
  label: string;
  kind: WindowKind;
  /** What the window was opened on, if anything. */
  workspace: string | null;
  /** A tab torn off another window, waiting for the layout (flexlayout JSON). */
  tab: string | null;
  loaded: boolean;
};

export const useAppWindow = create<AppWindow>(() => ({
  label: 'main',
  kind: { type: 'full' },
  workspace: null,
  tab: null,
  loaded: !can.multiWindow,
}));

let loading: Promise<void> | null = null;

/**
 * Asks once per page: the backend hands a torn-off tab out only once, and
 * React's StrictMode runs the startup effect twice in development, whose
 * second answer (no tab) used to replace the first.
 */
export function loadAppWindow(): Promise<void> {
  if (!can.multiWindow) return Promise.resolve();
  loading ??= commands.getWindowInit().then((init: WindowInit) => {
    useAppWindow.setState({ ...init, loaded: true });
  });
  return loading;
}

export function isEditorWindow(): boolean {
  return useAppWindow.getState().kind.type === 'editor';
}

/** The torn-off tab this window opened with, once. */
export function takeInitialTab(): string | null {
  const { tab } = useAppWindow.getState();
  if (tab) useAppWindow.setState({ tab: null });
  return tab;
}

/**
 * The workspace file a window keeps its tabs in. Editor windows have one
 * each; the Rust side deletes it when the window is closed for good.
 */
export function layoutFileFor(w: Pick<AppWindow, 'label' | 'kind'>): string {
  return w.kind.type === 'editor' ? `layout-${w.label}.json` : 'layout.json';
}

/**
 * Whether startup reopens the most recent workspace. Only the first window
 * does: a New Window starts empty, rather than on a workspace another window
 * already has.
 */
export function restoresLastWorkspace(w: Pick<AppWindow, 'label' | 'kind' | 'workspace'>): boolean {
  return w.label === 'main' && w.kind.type === 'full' && !w.workspace;
}

/** Opens a workspace in a full window of its own, or brings forward the one showing it. */
export function openInNewWindow(workspace: string) {
  void commands.openWindow({ editor: false, workspace, tab: null, at: null });
}
