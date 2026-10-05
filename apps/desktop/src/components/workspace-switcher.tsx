import { Check, ChevronsUpDown, CloudDownload, FolderOpen, Plus, Settings2 } from 'lucide-react';
import { isDesktop } from '@/lib/backend';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuItem,
  DropdownMenuGroup,
} from '@sunstead/ui/components/dropdown-menu';
import {
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from '@sunstead/ui/components/resizable-sidebar';
import { useWorkspace } from '@/hooks/use-workspace';
import { useKnownWorkspaces } from '@/lib/stores/known-workspaces';
import { useWorkspaceDialogs } from '@/lib/stores/workspace-dialogs';

export function WorkspaceSwitcher() {
  const activePath = useWorkspace((s) => s.path);
  const setWorkspace = useWorkspace((s) => s.setWorkspace);
  const openFolder = useWorkspace((s) => s.openFolder);
  const workspaces = useKnownWorkspaces((s) => s.workspaces);
  const showDialog = useWorkspaceDialogs((s) => s.show);

  const active = workspaces.find((w) => w.path === activePath);
  const activeName =
    active?.name ??
    (activePath ? activePath.split(/[\\/]/).pop() : 'No workspace open');

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size='default'
                className='data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground'
              >
                <div className='grid flex-1 text-left text-sm leading-tight'>
                  <span className='truncate font-medium'>{activeName}</span>
                </div>
                <ChevronsUpDown className='ml-auto size-4' />
              </SidebarMenuButton>
            }
          />
          <DropdownMenuContent
            className='w-(--anchor-width) min-w-56 rounded-lg'
            side='top'
            align='start'
            sideOffset={4}
          >
            {workspaces.length > 0 && (
              <>
                <DropdownMenuGroup>
                  <DropdownMenuLabel className='text-xs text-muted-foreground'>
                    Workspaces
                  </DropdownMenuLabel>
                  {workspaces.map((workspace) => (
                    <DropdownMenuItem
                      key={workspace.path}
                      onClick={() => setWorkspace(workspace.path)}
                    >
                      <span className='flex-1 truncate'>{workspace.name}</span>
                      {workspace.path === activePath && (
                        <Check className='size-4' />
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem onClick={() => showDialog('new')}>
              <Plus />
              New workspace…
            </DropdownMenuItem>
            {/* On the web, workspaces are the vaults on the server. */}
            {isDesktop && (
              <>
                <DropdownMenuItem onClick={() => showDialog('import')}>
                  <CloudDownload />
                  Import from sync…
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => openFolder()}>
                  <FolderOpen />
                  Open folder as workspace…
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => showDialog('manage')}>
              <Settings2 />
              Manage workspaces…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
