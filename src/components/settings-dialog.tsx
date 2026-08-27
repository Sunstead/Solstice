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
    <div className='flex gap-1 overflow-x-auto mx-2 md:pt-0 py-2 md:pb-3 md:hidden scrollbar-none [&::-webkit-scrollbar]:hidden'>
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
  const workspacePath = useWorkspace((s) => s.path);

  const section = getSection(activeSection);
  const CustomPane = customPanes[activeSection];

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent
        showCloseButton={false}
        className='flex h-[min(90svh,680px)] w-[calc(100%-2rem)] flex-col overflow-hidden bg-background p-0 sm:max-w-4xl'
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
            className='hidden w-52 min-w-52 bg-sidebar text-sidebar-foreground md:flex'
          >
            <SidebarContent>
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
            <div className='z-10 border-b items-center flex px-2 sm:py-2'>
              <SectionTabs active={activeSection} onSelect={setActiveSection} />
              <DialogClose
                className='z-20 order-1 ml-auto'
                render={
                  <Button variant='ghost' size='icon-sm'>
                    <X />
                  </Button>
                }
              />
              {/* The tab strip already names the active section below md. */}
              <div className='hidden md:block md:px-4'>
                <h2 className='hidden text-base font-medium md:block'>
                  {section.label}
                </h2>
              </div>
              {!workspacePath && (
                <p className='pt-1 text-xs text-muted-foreground/80 italic'>
                  No workspace is open, so per-workspace overrides are
                  unavailable.
                </p>
              )}
            </div>
            <ScrollArea className='h-full'>
              <div className='flex min-h-full flex-col'>
                <div className='px-4 pb-8 md:px-6'>
                  {CustomPane ? (
                    <CustomPane />
                  ) : (
                    <SettingsPane section={activeSection} />
                  )}
                </div>
              </div>
            </ScrollArea>
          </SidebarInset>
        </SidebarProvider>
      </DialogContent>
    </Dialog>
  );
}
