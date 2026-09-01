import { useEffect, useState } from 'react';

import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { clampToRange } from '@/lib/settings/store';
import type { AnySettingDef, NumberDef } from '@/lib/settings/types';

/**
 * Controls needing the full row width, which `SettingRow` stacks under the
 * label rather than placing beside it.
 */
export function isWideControl(def: AnySettingDef) {
  return def.kind === 'enum';
}

interface SettingControlProps {
  def: AnySettingDef;
  value: unknown;
  onChange: (value: unknown) => void;
  id: string;
}

/**
 * The only place setting kinds are enumerated. Adding a kind is a type and a
 * builder in `lib/settings/types.ts`, a `coerce` case in the store, and a case
 * here — the registry and the panes are untouched.
 */
export function SettingControl({ def, value, onChange, id }: SettingControlProps) {
  switch (def.kind) {
    case 'boolean':
      return (
        <Switch
          id={id}
          checked={value as boolean}
          onCheckedChange={onChange}
        />
      );

    case 'enum':
      return (
        <RadioGroup
          value={value as string}
          onValueChange={onChange}
          aria-labelledby={id}
          className='pb-2'
        >
          {def.options.map((option) => (
            // Radio.Root renders a hidden input, so a wrapping label delegates
            // clicks and the whole row becomes the hit target.
            <label
              key={option.value}
              className='flex cursor-pointer items-center gap-2.5 rounded-md border border-border/60 px-3 py-2 text-sm transition-colors has-data-checked:border-primary/50 has-data-checked:bg-foreground/3 hover:bg-foreground/2'
            >
              <RadioGroupItem value={option.value} />
              {option.label}
            </label>
          ))}
        </RadioGroup>
      );

    case 'text':
      // Committed on every keystroke rather than on blur: unlike a number, a
      // half-typed string is still a valid value, and the store debounces the
      // write anyway.
      return (
        <Input
          id={id}
          className='h-8 w-52 text-sm'
          value={value as string}
          placeholder={def.placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      );

    case 'number':
      if (def.control === 'slider') {
        return (
          <div className='flex w-52 items-center gap-3'>
            <Slider
              value={value as number}
              min={def.min}
              max={def.max}
              step={def.step}
              onValueChange={(next) => onChange(next as number)}
            />
            <span className='w-14 shrink-0 text-right text-xs tabular-nums text-muted-foreground'>
              {value as number}
              {def.unit}
            </span>
          </div>
        );
      }
      return (
        <NumberInput
          id={id}
          def={def}
          value={value as number}
          onChange={onChange}
        />
      );
  }
}

/**
 * Held in local draft state so a half-typed number never reaches the store: the
 * store clamps on read, so committing every keystroke would snap the field to
 * `min` mid-edit (typing "1" on the way to "18"), and an empty field is NaN.
 *
 * A draft that is already valid and in range commits immediately, keeping the
 * live preview these settings exist for. Anything else waits for blur.
 */
function NumberInput({
  id,
  def,
  value,
  onChange,
}: {
  id: string;
  def: NumberDef;
  value: number;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));

  // Re-sync when the value changes elsewhere: a reset, or a workspace switch.
  useEffect(() => setDraft(String(value)), [value]);

  const commit = () => {
    const parsed = Number(draft);
    if (draft.trim() === '' || !Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const next = clampToRange(def, parsed);
    setDraft(String(next));
    if (next !== value) onChange(next);
  };

  return (
    <div className='relative w-28'>
      <Input
        id={id}
        type='number'
        className='h-8 pr-8 text-sm tabular-nums'
        value={draft}
        min={def.min}
        max={def.max}
        step={def.step}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          const parsed = Number(next);
          const inRange =
            next.trim() !== '' &&
            Number.isFinite(parsed) &&
            clampToRange(def, parsed) === parsed;
          if (inRange && parsed !== value) onChange(parsed);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
          if (event.key === 'Escape') setDraft(String(value));
        }}
      />
      {def.unit && (
        <span className='pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs text-muted-foreground'>
          {def.unit}
        </span>
      )}
    </div>
  );
}
