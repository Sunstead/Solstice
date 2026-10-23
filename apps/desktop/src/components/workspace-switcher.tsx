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
import { Button } from '@sunstead/ui/components/button';
import {
  SidebarMenuButton,
} from '@sunstead/ui/components/resizable-sidebar';
import { refreshWorkspaceColors, useWorkspaceChoices } from '@/hooks/use-workspace-choices';
import { WorkspaceIcon } from '@/components/workspace-icon';
import { can, touchFirst } from '@/lib/backend/platform';
import { openInNewWindow } from '@/lib/stores/app-window';

type WorkspaceSwitcherVariant = 'explorer' | 'titlebar' | 'icon';

export function WorkspaceSwitcher({
  variant = 'explorer',
}: {
  variant?: WorkspaceSwitcherVariant;
}) {
  const { activePath, activeName, activeColor, workspaces, switchTo, actions, manage } = useWorkspaceChoices();

  return (
    <DropdownMenu onOpenChange={(open) => open && refreshWorkspaceColors()}>
      <DropdownMenuTrigger
        render={
          variant === 'explorer' ? (
            <SidebarMenuButton
              size='default'
              className='data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground'
            >
              {activeName && activeColor && <WorkspaceIcon name={activeName} color={activeColor} />}
              <div className='grid flex-1 text-left text-sm leading-tight'>
                <span className='truncate font-medium'>{activeName ?? 'No workspace open'}</span>
              </div>
              <ChevronsUpDown className='ml-auto size-4' />
            </SidebarMenuButton>
          ) : variant === 'icon' ? (
            <Button
              variant='ghost'
              size='icon'
              className='no-drag size-10 touch:size-12 data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground'
              aria-label={`Workspace: ${activeName ?? 'No workspace open'}`}
              title={activeName ?? 'No workspace open'}
            >
              {activeName && activeColor ? (
                <WorkspaceIcon
                  name={activeName}
                  color={activeColor}
                  size={touchFirst ? 'xl' : 'lg'}
                />
              ) : (
                <ChevronsUpDown />
              )}
            </Button>
          ) : (
            <Button
              variant='ghost'
              size='sm'
              className='no-drag max-w-48 gap-1.5 px-2 data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground'
            >
              {activeName && activeColor && <WorkspaceIcon name={activeName} color={activeColor} />}
              <span className='truncate text-sm font-medium'>{activeName ?? 'No workspace open'}</span>
              <ChevronsUpDown className='size-4 shrink-0' />
            </Button>
          )
        }
      />
      <DropdownMenuContent
        className='w-(--anchor-width) min-w-56 rounded-lg'
        side={variant === 'icon' ? 'right' : variant === 'explorer' ? 'top' : 'bottom'}
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
                  // Cmd/Ctrl-click opens it in a window of its own.
                  onClick={(e) => (can.multiWindow && (e.metaKey || e.ctrlKey) ? openInNewWindow(workspace.path) : switchTo(workspace.path))}
                >
                  <WorkspaceIcon name={workspace.name} color={workspace.color} />
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
  );
}
