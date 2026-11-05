import { SidebarInset, useSidebar } from '@sunstead/ui/components/resizable-sidebar';
import { AppSidebar } from '@/components/app-sidebar';
import { TitleBarShell } from '@/components/title-bar';
import { cn } from '@/lib/utils';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { registerCommand, unregisterCommand } from '@/lib/commands';
import { useWorkspaceUIStore } from '@/lib/stores/workspace-ui-store';
import { toggleZen, useZen, useZenAllowed, useZenAttribute } from '@/lib/zen';
import { createZenController, type ZenController } from '@/lib/zen-controller';

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

  // The switch is read as it's asked for, before React lays the new mode
  // out, and eased from there once it has (`zen-controller.ts`).
  const frame = useRef<HTMLDivElement>(null);
  const column = useRef<HTMLDivElement>(null);
  const inset = useRef<HTMLElement>(null);
  const zenMotion = useRef<ZenController>(null);
  // Made in the first effect that needs it: it holds the refs, read only there.
  const motion = () => (zenMotion.current ??= createZenController({ frame, inset, column }));
  useEffect(
    () =>
      useWorkspaceUIStore.subscribe((s, prev) => {
        // Not allowed here, the flag is inert and no commit would end it.
        if (zenAllowed && s.zen !== prev.zen) motion().prepare(s.zen);
      }),
    [zenAllowed],
  );
  useLayoutEffect(() => motion().play(zen), [zen]);

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
