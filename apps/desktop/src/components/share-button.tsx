import { Share } from 'lucide-react';

import { Button } from '@sunstead/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@sunstead/ui/components/dropdown-menu';
import { can, touchFirst } from '@/lib/backend/platform';
import { shareFile } from '@/lib/share/actions';
import { fileActions, shareAsLabel } from '@/lib/share/targets';
import { cn } from '@/lib/utils';

/**
 * Share, in a file's header on a computer (touch screens have it in ⋯): straight to the share
 * sheet, or first a choice of what to send (a note as PDF or Markdown).
 * Nothing where there's no share sheet. Its box is where the sheet points,
 * from here and from the file's menus (`data-share-anchor`).
 */
export function ShareButton({ path, className }: { path: string; className?: string }) {
  const formats = fileActions(path, can).share;
  if (formats.length === 0) return null;

  const rectOf = (element: Element) => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x, y, width, height };
  };
  const button = (
    <Button
      variant='ghost'
      size={touchFirst ? 'icon' : 'icon-sm'}
      title='Share'
      data-share-anchor={path}
      className={cn(className)}
      onClick={formats.length === 1 ? (e) => void shareFile(path, formats[0], rectOf(e.currentTarget)) : undefined}
    >
      <Share />
      <span className='sr-only'>Share</span>
    </Button>
  );
  if (formats.length === 1) return button;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={button} />
      <DropdownMenuContent className='w-max min-w-40' align='end' finalFocus={touchFirst ? false : undefined}>
        {formats.map((format) => (
          <DropdownMenuItem
            key={format}
            onClick={() => {
              const trigger = document.querySelector(`[data-share-anchor="${CSS.escape(path)}"]`);
              void shareFile(path, format, trigger ? rectOf(trigger) : null);
            }}
          >
            {shareAsLabel(format, path).replace(/\.\.\.$/, '')}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
