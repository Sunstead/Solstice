import { RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { SettingKey } from '@/lib/settings/registry';
import { hasOpenWorkspace } from '@/lib/stores/scoped-storage';
import {
  resetSetting,
  setSettingRaw,
  useSettingWithMeta,
} from '@/lib/settings/store';
import { SettingControl, isWideControl } from './setting-control';

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
    <div className='min-w-0 flex-1 space-y-1'>
      <Label
        id={id}
        htmlFor={wide ? undefined : id}
        className='text-sm font-medium'
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
      <div className='flex items-center justify-between gap-8'>
        {heading}
        <div className='flex shrink-0 items-center gap-1.5 pt-0.5'>
          {resetButton}
          {!wide && control}
        </div>
      </div>
      {wide && <div className='pt-2.5'>{control}</div>}
    </div>
  );
}
