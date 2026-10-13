import { useEffect, useId, useRef } from 'react';
import { nativeSurfaces, type SurfaceKind } from '@/lib/backend/native';
import { useFindStore } from '@/lib/stores/find';
import { follow, refreshers, retainHost, seeThrough, unmark } from '@/lib/native-surfaces';
import { useFileVersion } from '@/lib/viewer/file-version';

/**
 * Where a native view goes (iOS, `can.nativeViews`): a see-through hole the
 * system's view shows through from under the webview. It keeps that view on
 * its frame, hidden while the tab is, and tells it when the file changes.
 */
export function NativeSurface({ kind, path }: { kind: SurfaceKind; path: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const release = retainHost();
    void nativeSurfaces.open(id, kind, path);

    let last = '';
    const under = new Set<Element>();
    const measure = () => {
      const r = el.getBoundingClientRect();
      const visible = r.width > 0 && r.height > 0 && el.checkVisibility?.() !== false;
      const key = `${r.x},${r.y},${r.width},${r.height},${visible}`;
      if (key === last) return false;
      last = key;
      if (visible) seeThrough(el, r, under);
      void nativeSurfaces.place(id, { x: r.x, y: r.y, width: r.width, height: r.height }, visible);
      return true;
    };
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
      stopFollowing();
      for (const below of under) unmark(below);
      void nativeSurfaces.close(id);
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

  useEffect(() => {
    let current = true;
    void nativeSurfaces.find(id, open ? query : '', caseSensitive, wholeWord).then((found) => {
      if (current && found && open) useFindStore.getState().reportMatches(found.count, found.active);
    });
    return () => {
      current = false;
    };
  }, [id, open, query, caseSensitive, wholeWord]);

  useEffect(() => {
    if (!open || !stepRequest) return;
    void nativeSurfaces.findStep(id, stepRequest.direction).then((stepped) => {
      if (!stepped) return;
      const { matchCount } = useFindStore.getState();
      useFindStore.getState().reportMatches(matchCount, stepped.active);
    });
  }, [id, open, stepRequest]);
}
