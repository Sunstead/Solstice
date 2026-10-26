import { useEffect } from 'react';

import { useLayout } from '@/hooks/use-layout';
import { useWorkspace } from '@/hooks/use-workspace';
import { commands } from '@/lib/backend';
import { nativeAccessibility, nativeLaunch, type AccessibilityState, type LaunchAction } from '@/lib/backend/native';
import { can } from '@/lib/backend/platform';
import { runCommand } from '@/lib/commands';
import { getFileNameFromPath, getRelativePath, parentPath } from '@/lib/path-utils';
import { stripPresetExtension } from '@/lib/stores/entry-input';
import { useKnownWorkspaces } from '@/lib/stores/known-workspaces';
import { useFileIndex } from '@/lib/stores/use-file-index';

/** Whether `path` is inside `root`. */
const within = (root: string, path: string) => path === root || path.startsWith(root.endsWith('/') ? root : `${root}/`);

async function act(action: LaunchAction) {
  if (action.type === 'shortcut') {
    await runCommand(action.id === 'new-note' ? 'file.new_note' : 'edit.find_in_files');
    return;
  }
  // A Spotlight result: its workspace first, if another is open.
  if (!(await commands.exists(action.path))) return;
  const known = [useWorkspace.getState().path, ...useKnownWorkspaces.getState().workspaces.map((w) => w.path)]
    .filter((p): p is string => !!p)
    .sort((a, b) => b.length - a.length);
  const root = known.find((p) => within(p, action.path));
  if (root && root !== useWorkspace.getState().path) await useWorkspace.getState().setWorkspace(root);
  useLayout.getState().openFile(action.path, getFileNameFromPath(action.path));
}

let taken = false;

/**
 * The iOS app's Home Screen quick actions (New Note, Search) and Spotlight
 * results (`Launch.swift`): the one that launched it once the workspace is
 * ready, and any that come while it runs.
 */
export function useLaunchActions() {
  const noWorkspace = useWorkspace((s) => !s.loading && s.path === null);
  const hasLayout = useLayout((s) => s.model !== null);
  const ready = can.nativeViews && (noWorkspace || hasLayout);

  useEffect(() => {
    if (!ready) return;
    const listening = nativeLaunch.listen((action) => void act(action));
    if (!taken) {
      taken = true;
      void nativeLaunch.take().then(async (actions) => {
        for (const action of actions) await act(action);
      });
    }
    return () => void listening.then((listener) => listener.unregister());
  }, [ready]);
}

/** Notes Spotlight keeps, past which a workspace is cut short. */
const SPOTLIGHT_LIMIT = 5000;

/**
 * The open workspace's notes in Spotlight, by name and folder (not their
 * text): kept in step with the file index, a few seconds after it settles.
 */
export function useSpotlightIndex() {
  useEffect(() => {
    if (!can.nativeViews) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let sent = '';
    const send = () => {
      const { root, files, lastLoadedAt } = useFileIndex.getState();
      if (!root || lastLoadedAt === null) return;
      const name = getFileNameFromPath(root);
      const notes = files
        .filter((f) => !f.is_dir && f.name.endsWith('.md') && !getRelativePath(f.path, root).split('/').some((s) => s.startsWith('.')))
        .slice(0, SPOTLIGHT_LIMIT)
        .map((f) => ({
          path: f.path,
          title: stripPresetExtension(f.name).name,
          folder: [name, getRelativePath(parentPath(f.path), root)].filter(Boolean).join(' › '),
        }));
      const key = root + JSON.stringify(notes.map((n) => n.path));
      if (key === sent) return;
      sent = key;
      void nativeLaunch.spotlight(root, notes);
    };
    const stop = useFileIndex.subscribe(() => {
      clearTimeout(timer);
      timer = setTimeout(send, 3000);
    });
    send();
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, []);
}

function applyAccessibility(state: AccessibilityState | null) {
  if (!state) return;
  const root = document.documentElement;
  root.toggleAttribute('data-reduce-transparency', state.reduceTransparency);
  root.toggleAttribute('data-increase-contrast', state.increaseContrast);
  root.toggleAttribute('data-system-reduce-motion', state.reduceMotion);
}

/**
 * Reduce Transparency, Increase Contrast and Reduce Motion as the iOS app's
 * system has them, as attributes on `<html>` (app.css): WebKit can't tell
 * the page the first.
 */
export function useSystemAccessibility() {
  useEffect(() => {
    if (!can.nativeViews) return;
    void nativeAccessibility.get().then(applyAccessibility);
    const listening = nativeAccessibility.listen(applyAccessibility);
    return () => void listening.then((listener) => listener.unregister());
  }, []);
}
