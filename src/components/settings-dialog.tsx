import {
  Bell,
  Check,
  Globe,
  Home,
  Keyboard,
  Link,
  Lock,
  LucideIcon,
  Menu,
  MessageCircle,
  Paintbrush,
  Settings,
  Video,
} from 'lucide-react';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
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
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbSeparator,
  BreadcrumbPage,
} from './ui/breadcrumb';
import { ScrollArea } from './ui/scroll-area';
import { useState } from 'react';

const data: { nav: { name: string; icon: LucideIcon }[] } = {
  nav: [
    { name: 'Notifications', icon: Bell },
    { name: 'Navigation', icon: Menu },
    { name: 'Home', icon: Home },
    { name: 'Appearance', icon: Paintbrush },
    { name: 'Messages & media', icon: MessageCircle },
    { name: 'Language & region', icon: Globe },
    { name: 'Accessibility', icon: Keyboard },
    { name: 'Mark as read', icon: Check },
    { name: 'Audio & video', icon: Video },
    { name: 'Connected accounts', icon: Link },
    { name: 'Privacy & visibility', icon: Lock },
    { name: 'Advanced', icon: Settings },
  ],
};

export function SettingsDialog() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant='ghost' size='icon' className='size-10'>
            <Settings className='size-5' />
            <span className='sr-only'>Settings</span>
          </Button>
        }
      />
      <DialogContent className='flex h-[min(90svh,680px)] flex-col overflow-hidden bg-background p-0 sm:max-w-5xl'>
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
            className='bg-sidebar text-sidebar-foreground hidden md:flex'
          >
            <SidebarContent>
              <SidebarGroup>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {data.nav.map((item) => (
                      <SidebarMenuItem key={item.name}>
                        <SidebarMenuButton
                          isActive={item.name === 'Messages & media'}
                          render={
                            <a href='#'>
                              <item.icon />
                              <span>{item.name}</span>
                            </a>
                          }
                        />
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>
          </Sidebar>
          <SidebarInset className='min-h-0 overflow-hidden bg-background'>
            <ScrollArea className='h-full'>
              <div className='flex min-h-full flex-col'>
                <div className='sticky top-0 z-10 flex h-16 items-center gap-2 bg-background px-4'>
                  <Breadcrumb>
                    <BreadcrumbList>
                      <BreadcrumbItem className='hidden md:block'>``
                        <BreadcrumbLink href='#'>Settings</BreadcrumbLink>
                      </BreadcrumbItem>
                      <BreadcrumbSeparator className='hidden md:block' />
                      <BreadcrumbItem>
                        <BreadcrumbPage>Messages & media</BreadcrumbPage>
                      </BreadcrumbItem>
                    </BreadcrumbList>
                  </Breadcrumb>
                </div>
                <div className='flex flex-col gap-4 p-4 pt-0'>
                  {Array.from({ length: 10 }).map((_, i) => (
                    <div
                      key={i}
                      className='aspect-video max-w-3xl rounded-xl bg-muted/50'
                    />
                  ))}
                </div>
              </div>
            </ScrollArea>
          </SidebarInset>
        </SidebarProvider>
      </DialogContent>
    </Dialog>
  );
}
