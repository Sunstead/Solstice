import { Check, ChevronsUpDown, CloudDownload, FolderOpen, Plus, Settings2, type LucideIcon } from 'lucide-react';
import { can } from '@/lib/backend/platform';
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

export type WorkspaceAction = { id: string; label: string; icon: LucideIcon; run: () => void };

/**
 * The open workspace, the others to switch to, and what can be done about
 * them: the sidebar's switcher and the phone's workspace sheet.
 */
export function useWorkspaceChoices() {
  const activePath = useWorkspace((s) => s.path);
  const setWorkspace = useWorkspace((s) => s.setWorkspace);
  const openFolder = useWorkspace((s) => s.openFolder);
  const workspaces = useKnownWorkspaces((s) => s.workspaces);
  const showDialog = useWorkspaceDialogs((s) => s.show);

  const active = workspaces.find((w) => w.path === activePath);
  const activeName = active?.name ?? (activePath ? activePath.split(/[\\/]/).pop()! : null);

  const actions: WorkspaceAction[] = [
    { id: 'new', label: 'New workspace…', icon: Plus, run: () => showDialog('new') },
    // On the web, workspaces are the vaults on the server.
    ...(can.localFolders
      ? [{ id: 'import', label: 'Import from sync…', icon: CloudDownload, run: () => showDialog('import') }]
      : []),
    ...(can.pickFolders
      ? [{ id: 'open', label: 'Open folder as workspace…', icon: FolderOpen, run: () => void openFolder() }]
      : []),
  ];
  const manage: WorkspaceAction = {
    id: 'manage',
    label: 'Manage workspaces…',
    icon: Settings2,
    run: () => showDialog('manage'),
  };

  return { activePath, activeName, workspaces, switchTo: setWorkspace, actions, manage };
}

export function WorkspaceSwitcher() {
  const { activePath, activeName, workspaces, switchTo, actions, manage } = useWorkspaceChoices();

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
                  <span className='truncate font-medium'>{activeName ?? 'No workspace open'}</span>
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
                      onClick={() => switchTo(workspace.path)}
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
            {actions.map((action) => (
              <DropdownMenuItem key={action.id} onClick={action.run}>
                <action.icon />
                {action.label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={manage.run}>
              <manage.icon />
              {manage.label}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
