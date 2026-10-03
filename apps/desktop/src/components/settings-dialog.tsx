import { useRef } from 'react';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from './ui/dialog';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from '@/components/ui/resizable-sidebar';
import { ScrollArea } from './ui/scroll-area';
import { cn } from '@/lib/utils';
import { customPanes } from './settings/panes';
import { SettingsPane } from './settings/settings-pane';
import { SettingsSearch } from './settings/settings-search';
import { SettingsSearchResults } from './settings/settings-search-results';
import {
  getSection,
  settingsSections,
  type SectionId,
} from '@/lib/settings/sections';
import { useSettingsDialog } from '@/lib/stores/settings-dialog';
import { useWorkspace } from '@/hooks/use-workspace';
import { Button } from './ui/button';
import { X } from 'lucide-react';

/**
 * Section nav for widths below the sidebar breakpoint. The sidebar is hidden
 * there, so without this there would be no way to leave the first section.
 * Scrolls horizontally rather than wrapping, to keep the row one line tall.
 */
function SectionTabs({
  active,
  onSelect,
}: {
  active: SectionId;
  onSelect: (id: SectionId) => void;
}) {
  return (
    <div className='flex gap-1 overflow-x-auto md:pt-0 pt-2 md:py-2 md:pb-3 md:hidden scrollbar-none [&::-webkit-scrollbar]:hidden'>
      {settingsSections.map((section) => (
        <button
          key={section.id}
          type='button'
          onClick={() => onSelect(section.id)}
          className={cn(
            'flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap text-muted-foreground select-none',
            section.id === active && 'bg-foreground/8 text-foreground',
          )}
        >
          <section.icon className='size-4' />
          {section.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The single app-wide settings dialog. Rendered once at the root; open it via
 * `useSettingsDialog().openSettings()` or the `app.settings` command.
 *
 * The nav comes from `settingsSections` and the body from the settings
 * registry, so neither grows when a setting is added.
 */
export function SettingsDialog() {
  const open = useSettingsDialog((s) => s.open);
  const close = useSettingsDialog((s) => s.close);
  const activeSection = useSettingsDialog((s) => s.activeSection);
  const setActiveSection = useSettingsDialog((s) => s.setActiveSection);
  const query = useSettingsDialog((s) => s.query.trim());
  const workspacePath = useWorkspace((s) => s.path);

  const section = getSection(activeSection);
  const CustomPane = customPanes[activeSection];

  // Base UI otherwise focuses the first tabbable element, which is the search
  // field. Focusing the panel keeps the dialog announced without capturing the
  // first keystroke into search.
  const panelRef = useRef<HTMLDivElement>(null);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent
        ref={panelRef}
        initialFocus={panelRef}
        showCloseButton={false}
        className='flex h-[min(92svh,860px)] w-[calc(100%-2rem)] flex-col overflow-hidden bg-background p-0 sm:max-w-6xl'
      >
        <DialogTitle className='sr-only'>Settings</DialogTitle>
        <DialogDescription className='sr-only'>
          Customize your settings here.
        </DialogDescription>
        {/* Row flex container: align-items defaults to stretch, which is
            what gives SidebarInset a definite height to hand down to
            ScrollArea below. */}
        <SidebarProvider className='min-h-0 flex-1'>
          <Sidebar
            collapsible='none'
            className='hidden w-56 min-w-56 bg-sidebar text-sidebar-foreground md:flex'
          >
            <SidebarContent>
              <div className='px-2 pt-2'>
                <SettingsSearch />
              </div>
              <SidebarGroup>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {settingsSections.map((item) => (
                      <SidebarMenuItem key={item.id}>
                        <SidebarMenuButton
                          isActive={item.id === activeSection}
                          onClick={() => setActiveSection(item.id)}
                        >
                          <item.icon />
                          <span>{item.label}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>
          </Sidebar>
          <SidebarInset className='min-h-0 overflow-hidden bg-background'>
            <div className='z-10 border-b px-2 py-2'>
              <div className='flex items-center gap-2'>
                {/* The tab strip already names the active section below md. */}
                <h2 className='hidden px-2 text-base font-medium md:block'>
                  {query ? 'Results' : section.label}
                </h2>
                {/* From md up the sidebar carries the search field instead. */}
                <SettingsSearch className='min-w-0 flex-1 md:hidden' />
                <DialogClose
                  className='z-20 ml-auto shrink-0'
                  render={
                    <Button variant='ghost' size='icon-sm'>
                      <X />
                    </Button>
                  }
                />
              </div>
              <SectionTabs active={activeSection} onSelect={setActiveSection} />
              {!workspacePath && (
                <p className='px-2 pb-2 text-xs text-muted-foreground/80 italic'>
                  No workspace is open, so per-workspace overrides are
                  unavailable.
                </p>
              )}
            </div>
            <div className='flex-1 flex-col min-h-0 flex'>
              <ScrollArea className='h-full'>
                <div className='flex min-h-full flex-col'>
                  <div className='px-4 py-6 md:px-6 '>
                    {query ? (
                      <SettingsSearchResults query={query} />
                    ) : CustomPane ? (
                      <CustomPane />
                    ) : (
                      <SettingsPane section={activeSection} />
                    )}
                  </div>
                </div>
              </ScrollArea>
            </div>
          </SidebarInset>
        </SidebarProvider>
      </DialogContent>
    </Dialog>
  );
}
