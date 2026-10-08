import { Check, ChevronsUpDown } from 'lucide-react';
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
import { useWorkspaceChoices } from '@/hooks/use-workspace-choices';

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
