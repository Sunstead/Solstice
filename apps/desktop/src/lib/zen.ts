import { useLayoutEffect } from 'react';
import { useSidebar } from '@sunstead/ui/components/resizable-sidebar';
import { touchFirst } from '@/lib/backend/platform';
import { useWorkspaceUIStore } from '@/lib/stores/workspace-ui-store';

/**
 * Zen mode (the header's toggle, `view.toggle_zen_mode`): the shown tab fills
 * the window. Only on a touch-first tablet; a phone is already one tab, and a
 * computer has flexlayout's maximize and room to spare.
 */
export function zenAllowed(env: { touchFirst: boolean; isMobile: boolean }): boolean {
  return env.touchFirst && !env.isMobile;
}

/** Whether Zen can be offered here. */
export function useZenAllowed(): boolean {
  const { isMobile } = useSidebar();
  return zenAllowed({ touchFirst, isMobile });
}

/** Whether Zen is in effect: saved on, and allowed here (a saved flag is inert elsewhere). */
export function useZen(): boolean {
  const allowed = useZenAllowed();
  const zen = useWorkspaceUIStore((s) => s.zen);
  return allowed && zen;
}

/** Mirrors Zen onto `<html data-zen>` for the shell's and flexlayout's CSS. Mount once. */
export function useZenAttribute(zen: boolean): void {
  // Before paint, so the strip and the column change in the same frame.
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (zen) root.dataset.zen = '';
    else delete root.dataset.zen;
  }, [zen]);
}

export function toggleZen(): void {
  const { zen, setZen } = useWorkspaceUIStore.getState();
  setZen(!zen);
}
