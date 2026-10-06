import FlexLayoutRoot from '@/components/flex-layout-root';
import { MobileWorkspace } from '@/components/mobile/mobile-workspace';
import { useSidebar } from '@sunstead/ui/components/resizable-sidebar';

/**
 * Tabs and splits, or below the sidebar's breakpoint (where the sidebar is a
 * drawer and the tabs would not fit) one tab at a time; see MobileWorkspace.
 */
export function EditorArea() {
  const { isMobile } = useSidebar();
  return <div className='h-full w-full'>{isMobile ? <MobileWorkspace /> : <FlexLayoutRoot />}</div>;
}
