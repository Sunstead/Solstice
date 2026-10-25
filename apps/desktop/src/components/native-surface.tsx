import { useEffect, useRef } from 'react';
import { nativeSurfaces, type SurfaceKind } from '@/lib/backend/native';
import { useFindStore } from '@/lib/stores/find';
import {
  follow,
  onSurfaceEase,
  refreshers,
  retainHost,
  seeThrough,
  surfaceEasing,
  unmark,
  useSurfaceStates,
} from '@/lib/native-surfaces';
import { useFileVersion } from '@/lib/viewer/file-version';

/**
 * Where a native view goes (iOS, `can.nativeViews`): a see-through hole the
 * system's view shows through from under the webview. It keeps that view on
 * its frame, hidden while the tab is, and tells it when the file changes.
 */
export function NativeSurface({ id, kind, path }: { id: string; kind: SurfaceKind; path: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const release = retainHost();
    void nativeSurfaces.open(id, kind, path);

    let last = '';
    let size = '';
    let held = false;
    // The motion can start before this surface's resize is measured (a
    // frame on): its play then waits for the hold.
    let playing = false;
    const under = new Set<Element>();
    const measure = () => {
      const r = el.getBoundingClientRect();
      const visible = r.width > 0 && r.height > 0 && el.checkVisibility?.() !== false;
      const key = `${r.x},${r.y},${r.width},${r.height},${visible}`;
      if (key === last) return false;
      // A Zen switch's new size: taken at once, the content held where it
      // was until the page moves (`beginSurfaceEase`).
      // Rounded: a moving pane's size wobbles in its last decimal place.
      const now = `${Math.round(r.width)},${Math.round(r.height)}`;
      const resized = size !== '' && size !== now;
      const hold = resized && surfaceEasing();
      if (hold) held = true;
      last = key;
      size = now;
      const backdrop = visible ? seeThrough(el, r, under) : null;
      void nativeSurfaces.place(id, { x: r.x, y: r.y, width: r.width, height: r.height }, visible, backdrop, hold);
      if (hold && playing) void nativeSurfaces.ease(id, 'play');
      return true;
    };
    const stopEase = onSurfaceEase((phase) => {
      playing = phase === 'play';
      if (!held) return;
      if (phase === 'end') held = false;
      void nativeSurfaces.ease(id, phase);
    });
    const stopFollowing = follow(el, measure);
    // A new theme: what's under the surface is measured afresh, colours and all.
    const refresh = () => {
      for (const below of under) unmark(below);
      under.clear();
      last = '';
      measure();
    };
    refreshers.add(refresh);
    return () => {
      refreshers.delete(refresh);
      stopEase();
      stopFollowing();
      for (const below of under) unmark(below);
      void nativeSurfaces.close(id);
      useSurfaceStates.setState((states) => {
        const { [id]: _closed, ...rest } = states;
        return rest;
      }, true);
      release();
    };
  }, [id, kind, path]);

  const version = useFileVersion(path);
  useEffect(() => {
    if (version > 0) void nativeSurfaces.reload(id);
  }, [id, version]);

  useNativeFind(id, path);

  return <div ref={ref} data-native-surface className='h-full w-full' />;
}

/** The find bar, searching in the native view. */
function useNativeFind(id: string, path: string) {
  const open = useFindStore((s) => s.openPath === path);
  const query = useFindStore((s) => s.query);
  const caseSensitive = useFindStore((s) => s.caseSensitive);
  const wholeWord = useFindStore((s) => s.wholeWord);
  const stepRequest = useFindStore((s) => s.stepRequest);
  // Asking again (another search hit) searches again, to go to its page.
  const focusNonce = useFindStore((s) => s.focusNonce);

  // A full-text search hit: the find bar opens on its query, then a PDF's
  // goes to the hit's page once the view has found its matches.
  const jumpRequest = useFindStore((s) => (s.jump?.path === path ? s.jump : null));
  const pendingPage = useRef<{ page: number; ink: boolean } | null>(null);
  useEffect(() => {
    if (!jumpRequest) return;
    const taken = useFindStore.getState().takeJump(path);
    if (!taken) return;
    if (taken.jump.type === 'page') pendingPage.current = { page: taken.jump.page, ink: taken.jump.ink };
    useFindStore.getState().openFor(path);
  }, [jumpRequest, path]);

  useEffect(() => {
    let current = true;
    void nativeSurfaces.find(id, open ? query : '', caseSensitive, wholeWord).then(async (found) => {
      if (!current || !found || !open) return;
      let active = found.active;
      const page = pendingPage.current;
      pendingPage.current = null;
      if (page) active = (await nativeSurfaces.findPage(id, page.page, page.ink))?.active ?? active;
      if (current) useFindStore.getState().reportMatches(found.count, active);
    });
    return () => {
      current = false;
    };
  }, [id, open, query, caseSensitive, wholeWord, focusNonce]);

  useEffect(() => {
    if (!open || !stepRequest) return;
    void nativeSurfaces.findStep(id, stepRequest.direction).then((stepped) => {
      if (!stepped) return;
      const { matchCount } = useFindStore.getState();
      useFindStore.getState().reportMatches(matchCount, stepped.active);
    });
  }, [id, open, stepRequest]);
}
