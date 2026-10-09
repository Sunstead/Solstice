import { CircleArrowDown } from 'lucide-react';
import { Button } from '@sunstead/ui/components/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@sunstead/ui/components/tooltip';
import { useUpdateWaiting, useUpdates } from '@/lib/stores/updates';

/** The title bar's sign of a waiting update; opens the update dialog. Hidden otherwise. */
export function UpdateIndicator() {
  const waiting = useUpdateWaiting();
  const version = useUpdates((s) => s.update?.version);
  if (!waiting) return null;

  const label = `Solstice ${version} is available`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant='ghost'
            size='icon-sm'
            aria-label={label}
            onClick={() => useUpdates.getState().openDialog()}
            className='text-primary'
          />
        }
      >
        <CircleArrowDown />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
