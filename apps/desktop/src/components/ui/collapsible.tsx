import { cn } from '@/lib/utils';
import { Collapsible as CollapsiblePrimitive } from '@base-ui/react/collapsible';

function Collapsible({ ...props }: CollapsiblePrimitive.Root.Props) {
  return <CollapsiblePrimitive.Root data-slot='collapsible' {...props} />;
}

function CollapsibleTrigger({ ...props }: CollapsiblePrimitive.Trigger.Props) {
  return (
    <CollapsiblePrimitive.Trigger data-slot='collapsible-trigger' {...props} />
  );
}

function CollapsibleContent({
  className,
  ...props
}: CollapsiblePrimitive.Panel.Props) {
  return (
    <CollapsiblePrimitive.Panel
      data-slot='collapsible-content'
      {...props}
      keepMounted
      className={cn(
        // Base UI measures the panel and publishes the result as
        // `--collapsible-panel-height`, then resets it to `auto` once the open
        // transition completes so later content changes reflow naturally.
        'h-(--collapsible-panel-height) overflow-hidden',
        'transition-[height] duration-150 ease-out',
        'data-starting-style:h-0 data-ending-style:h-0',
        className,
      )}
    />
  );
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent };
