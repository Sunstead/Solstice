import {
  ArrowUpRight,
  Clipboard,
  FileSearch,
  FolderTree,
  HardDrive,
  Monitor,
  MoreVertical,
  PencilLine,
  Trash,
} from 'lucide-react';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

export function FileActionsDropdown() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant='ghost' size='icon-sm'>
            <MoreVertical />
          </Button>
        }
      />
      <DropdownMenuContent className='w-max min-w-52'>
        <DropdownMenuItem>
          <FileSearch /> Find...
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Clipboard /> Copy path
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem>
              <Monitor /> from workspace folder
            </DropdownMenuItem>
            <DropdownMenuItem>
              <HardDrive /> from system root
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSeparator />

        <DropdownMenuItem>
          <ArrowUpRight /> Open in default app
        </DropdownMenuItem>
        <DropdownMenuItem>
          <ArrowUpRight /> Open in system explorer
        </DropdownMenuItem>
        

        <DropdownMenuSeparator />

        <DropdownMenuItem>
          <FolderTree /> Move file to...
        </DropdownMenuItem>
        <DropdownMenuItem>
          <PencilLine /> Rename
        </DropdownMenuItem>
        <DropdownMenuItem variant='destructive'>
          <Trash /> Delete file
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
