import { useState, type ReactElement } from 'react';

import { Popover, PopoverContent, PopoverTrigger } from '@sunstead/ui/components/popover';
import { WORKSPACE_SWATCHES, randomWorkspaceColor } from '@/lib/workspace/color';
import { ColorPickerPanel } from './color-picker-panel';

/**
 * Picks a workspace's color: a swatch, Shuffle, or any hex. `onChange(null)`
 * goes back to the color from the name. `onChange` returns an error to show,
 * if saving failed.
 */
export function WorkspaceColorPicker({
  color,
  picked,
  onChange,
  trigger,
}: {
  /** What the icon shows now. */
  color: string;
  /** Whether that color was picked (Reset is only for those). */
  picked: boolean;
  onChange: (color: string | null) => Promise<string | null> | void;
  trigger: ReactElement;
}) {
  // A new panel each time it opens, so the hex field starts from the color.
  const [opened, setOpened] = useState(0);

  return (
    <Popover onOpenChange={(open) => open && setOpened((n) => n + 1)}>
      <PopoverTrigger render={trigger} />
      <PopoverContent className='w-60 p-4' align='start'>
        <ColorPickerPanel
          key={opened}
          color={color}
          swatches={WORKSPACE_SWATCHES}
          onChoose={onChange}
          shuffle={randomWorkspaceColor}
          reset={{ title: 'Back to the color from the name', enabled: picked }}
        />
      </PopoverContent>
    </Popover>
  );
}
