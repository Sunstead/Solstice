import FlexLayoutRoot from '@/components/flex-layout-root';
import { PhoneShell } from '@/components/mobile/phone-shell';
import { useSidebar } from '@sunstead/ui/components/resizable-sidebar';

/**
 * Tabs and splits, or below the sidebar's breakpoint (where neither the
 * sidebar nor the tabs would fit) the phone layout; see PhoneShell.
 */
export function EditorArea() {
  const { isMobile } = useSidebar();
  return <div className='h-full w-full'>{isMobile ? <PhoneShell /> : <FlexLayoutRoot />}</div>;
}
