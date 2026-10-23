import FlexLayoutRoot from '@/components/flex-layout-root';
import { PhoneShell } from '@/components/mobile/phone-shell';
import { useSidebar } from '@sunstead/ui/components/resizable-sidebar';
import { isEditorWindow } from '@/lib/stores/app-window';

/**
 * Tabs and splits, or below the sidebar's breakpoint (where neither the
 * sidebar nor the tabs would fit) the phone layout; see PhoneShell.
 */
export function EditorArea() {
  const { isMobile } = useSidebar();
  // An editor window has no explorer, so never the phone layout's Files page.
  const phone = isMobile && !isEditorWindow();
  return <div className='h-full w-full'>{phone ? <PhoneShell /> : <FlexLayoutRoot />}</div>;
}
