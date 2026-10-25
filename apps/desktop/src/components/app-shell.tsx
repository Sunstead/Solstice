import { SidebarInset, useSidebar } from '@sunstead/ui/components/resizable-sidebar';
import { AppSidebar } from '@/components/app-sidebar';
import { TitleBarShell } from '@/components/title-bar';
import { cn } from '@/lib/utils';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { registerCommand, unregisterCommand } from '@/lib/commands';
import { useWorkspaceUIStore } from '@/lib/stores/workspace-ui-store';
import { toggleZen, useZen, useZenAllowed, useZenAttribute } from '@/lib/zen';
import { holdSurfaceSizes } from '@/lib/native-surfaces';
import { paneOrigin, playZen } from '@/lib/zen-motion';

/**
 * The title bar and sidebar column beside the editor area. A phone has
 * neither: the editor area is the whole app there (PhoneShell).
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const { isMobile, state } = useSidebar();
  const zen = useZen();
  useZenAttribute(zen);
  const zenAllowed = useZenAllowed();
  useEffect(() => {
    if (!zenAllowed) return;
    registerCommand('view.toggle_zen_mode', toggleZen);
    return () => unregisterCommand('view.toggle_zen_mode');
  }, [zenAllowed]);

  // Where the pane was, read as the switch is asked for, before React lays
  // the new mode out; the motion eases from there (`zen-motion.ts`).
  const frame = useRef<HTMLDivElement>(null);
  const column = useRef<HTMLDivElement>(null);
  const inset = useRef<HTMLElement>(null);
  const before = useRef<ReturnType<typeof paneOrigin> | null>(null);
  const releaseSizes = useRef<(() => void) | null>(null);
  useEffect(
    () =>
      useWorkspaceUIStore.subscribe((s, prev) => {
        if (s.zen === prev.zen) return;
        before.current = inset.current && paneOrigin(inset.current);
        // Out of the flow the column would shrink to its contents (the
        // sidebar's width is a placeholder's), and slide out as nothing. As
        // wide as all it draws (the explorer runs past its box), so sliding
        // it a whole width takes every bit off screen.
        const side = column.current;
        if (s.zen && side) {
          const right = Math.max(...[...side.querySelectorAll('*')].map((el) => el.getBoundingClientRect().right));
          side.style.setProperty('--zen-column', `${Math.max(side.offsetWidth, right - side.getBoundingClientRect().left)}px`);
        }
        // Set before React commits the switch, or the sidebar's own
        // transitions (and the inset's padding) start, and lag the slide.
        frame.current?.setAttribute('data-zen-moving', '');
        // A native view (PDF, drawing) takes its new size after the motion.
        releaseSizes.current?.();
        releaseSizes.current = holdSurfaceSizes();
      }),
    [],
  );
  useLayoutEffect(() => {
    const from = before.current;
    before.current = null;
    const el = inset.current;
    const shell = frame.current;
    const side = column.current;
    const release = releaseSizes.current;
    releaseSizes.current = null;
    if (!from || !el) {
      shell?.removeAttribute('data-zen-moving');
      release?.();
      // Opened in Zen: nothing to slide.
      if (zen) side?.style.setProperty('visibility', 'hidden');
      return;
    }
    // Shown for the slide; hidden once off screen, where a sliver of the
    // explorer would otherwise stay at the edge.
    side?.style.removeProperty('visibility');
    // Leaving, the pane starts up and to the left of where it lands: what it
    // uncovers on the right and below is the pane's color, not a gap.
    if (shell) shell.style.background = 'var(--background)';
    void playZen({ inset: el, column: side, entering: zen, before: from }).then(() => {
      shell?.removeAttribute('data-zen-moving');
      if (shell) shell.style.background = '';
      release?.();
      if (zen) side?.style.setProperty('visibility', 'hidden');
    });
  }, [zen]);

  return (
    // Clips the editor area while it eases in from under the tab strip.
    <div ref={frame} className='flex flex-1 min-h-0 relative w-full max-w-full overflow-hidden'>
      {!isMobile && (
        // In Zen the column (title bar, rail and all) leaves the flow and
        // sits off the left edge, kept mounted so the tree and its
        // registrations stay. Its own layer over the editor area: while
        // either moves by transform, the controls overhanging the tab strip
        // would otherwise go under the editor. Clipped in Zen, where they'd
        // hang into the screen.
        <div
          ref={column}
          className={cn('relative z-10 h-full flex flex-col', zen && 'absolute inset-y-0 left-0 w-(--zen-column) -translate-x-full overflow-hidden')}
          inert={zen}
        >
          <TitleBarShell />

          <div className='relative flex-1 min-h-0'>
            <AppSidebar />
          </div>
        </div>
      )}
      {/* With Islands, the editor's panes sit on the window's colour
          (`islands.css`), their tabs in the title bar's row: no gap on top.
          Collapsed, the rail's own margin is the gap, so the panes start
          where the explorer does when it's open. */}
      <SidebarInset
        ref={inset}
        className={cn(
          'islands:bg-sidebar islands:p-(--island-gap) islands:pt-0 islands:transition-[padding] islands:duration-200 islands:ease-in-out',
          // Touch-first: the panes run to the screen's right and bottom
          // edges (`islands.css` squares their corners there).
          'islands:touch:pr-0 islands:touch:pb-0',
          state === 'collapsed' && 'islands:pl-0',
          // Zen: the pane runs edge to edge.
          zen && 'islands:p-0',
        )}
      >
        {children}
      </SidebarInset>
    </div>
  );
}
