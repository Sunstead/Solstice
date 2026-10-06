import { RotateCcw } from 'lucide-react';

import { Button } from '@sunstead/ui/components/button';
import { Label } from '@sunstead/ui/components/label';
import { cn } from '@/lib/utils';
import type { SettingKey } from '@/lib/settings/registry';
import { hasOpenWorkspace } from '@/lib/stores/scoped-storage';
import {
  resetSetting,
  setSettingRaw,
  useSettingWithMeta,
} from '@/lib/settings/store';
import { SettingControl } from './setting-control';
import { isWideControl, stacksOnPhone } from './setting-layout';

/**
 * One row: label and the generated control. Narrow controls sit beside the
 * label, wide ones stack underneath for the full width.
 *
 * The geometry is fixed — nothing appears or disappears as a value changes, so
 * a control never moves out from under the pointer.
 */
export function SettingRow({ settingKey }: { settingKey: SettingKey }) {
  const { value, def, isOverridden, isCustomized, effectiveScope } =
    useSettingWithMeta(settingKey);

  const id = `setting-${settingKey}`;
  const disabled = def.scope === 'workspace' && !hasOpenWorkspace();
  const wide = isWideControl(def);
  // Below `sm` these wrap under their label instead of squeezing it.
  const stack = !wide && stacksOnPhone(def);

  const control = (
    <SettingControl
      id={id}
      def={def}
      value={value}
      onChange={(next) => setSettingRaw(settingKey, next)}
    />
  );

  // Always rendered, only sometimes visible: rendering it conditionally would
  // reflow the control beside it every time a value changed.
  const resetButton = (
    <Button
      variant='ghost'
      size='icon-sm'
      aria-hidden={!isCustomized}
      tabIndex={isCustomized ? undefined : -1}
      className={cn(
        // No transition: fading out reads as lag when a value returns to default.
        'text-muted-foreground transition-none',
        !isCustomized && 'pointer-events-none opacity-0',
      )}
      title={isOverridden ? 'Revert to the global value' : 'Reset to default'}
      onClick={() => resetSetting(settingKey, effectiveScope ?? undefined)}
    >
      <RotateCcw className='size-3.5' />
      <span className='sr-only'>Reset {def.label}</span>
    </Button>
  );

  const heading = (
    <div className={cn('min-w-0 flex-1 space-y-1', stack && 'max-sm:basis-full')}>
      {/* Never wraps: a two-line label changes the row's height and takes its
          control out of line with the rows around it. The ellipsis is a safety
          valve for a very narrow window, not the expected rendering. */}
      <Label
        id={id}
        htmlFor={wide ? undefined : id}
        title={def.label}
        className='block truncate text-sm font-medium'
      >
        {def.label}
      </Label>
      {disabled && (
        <p className='text-xs text-muted-foreground/80 italic'>
          Open a workspace to change this.
        </p>
      )}
    </div>
  );

  return (
    <div className={cn('py-2', disabled && 'pointer-events-none opacity-50')}>
      <div className={cn('flex items-center justify-between gap-4', stack && 'max-sm:flex-wrap max-sm:gap-y-2')}>
        {heading}
        <div className={cn('flex shrink-0 items-center gap-1.5 pt-0.5', stack && 'max-sm:w-full max-sm:flex-row-reverse')}>
          {resetButton}
          {!wide && control}
        </div>
      </div>
      {wide && <div className='pt-2.5'>{control}</div>}
    </div>
  );
}
