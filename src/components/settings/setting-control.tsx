import { useEffect, useState } from 'react';

import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import type { AnySettingDef, NumberDef } from '@/lib/settings/types';

/**
 * Controls that need the full row width, so `SettingRow` stacks them under the
 * label instead of placing them to its right.
 */
export function isWideControl(def: AnySettingDef) {
  return def.kind === 'enum' && def.control !== 'select';
}

interface SettingControlProps {
  def: AnySettingDef;
  value: unknown;
  onChange: (value: unknown) => void;
  id: string;
}

/**
 * The only place setting kinds are enumerated. Adding a kind is: a type and a
 * builder in `lib/settings/types.ts`, a validation case in the store, and a
 * case here -- nothing in the registry or the panes changes.
 */
export function SettingControl({ def, value, onChange, id }: SettingControlProps) {
  switch (def.kind) {
    case 'boolean':
      return (
        <Switch
          id={id}
          checked={value as boolean}
          onCheckedChange={(checked) => onChange(checked)}
        />
      );

    case 'enum': {
      if (def.control === 'select') {
        return (
          <Select
            value={value as string}
            onValueChange={(next) => next !== null && onChange(next)}
            items={def.options.map((o) => ({ value: o.value, label: o.label }))}
          >
            <SelectTrigger id={id} size='sm' className='w-52'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {def.options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      }

      return (
        <RadioGroup
          value={value as string}
          onValueChange={(next) => onChange(next)}
          aria-labelledby={id}
          className='pb-2'
        >
          {def.options.map((option) => (
            // The hidden input Radio.Root renders means a wrapping label
            // delegates clicks, so the whole row is the hit target.
            <label
              key={option.value}
              className='flex cursor-pointer items-start gap-2.5 rounded-md border border-border/60 px-3 py-2 transition-colors has-data-checked:border-primary/50 has-data-checked:bg-foreground/3 hover:bg-foreground/2'
            >
              <RadioGroupItem value={option.value} className='mt-0.5' />
              <span className='min-w-0 flex-1'>
                <span className='block text-sm leading-tight'>
                  {option.label}
                </span>
                {option.description && (
                  <span className='mt-1 block text-xs leading-relaxed text-muted-foreground'>
                    {option.description}
                  </span>
                )}
              </span>
            </label>
          ))}
        </RadioGroup>
      );
    }

    case 'number': {
      const numeric = value as number;

      if (def.control === 'slider') {
        return (
          <div className='flex w-52 items-center gap-3'>
            <Slider
              value={numeric}
              min={def.min}
              max={def.max}
              step={def.step}
              onValueChange={(next) => onChange(next as number)}
            />
            <span className='w-14 shrink-0 text-right text-xs tabular-nums text-muted-foreground'>
              {numeric}
              {def.unit}
            </span>
          </div>
        );
      }

      return <NumberControl id={id} def={def} value={numeric} onChange={onChange} />;
    }

    case 'string':
      return (
        <Input
          id={id}
          className='h-8 w-52 text-sm'
          value={value as string}
          placeholder={def.placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      );

    case 'custom': {
      const Component = def.component;
      return <Component value={value} onChange={onChange} />;
    }
  }
}


/**
 * Kept in local draft state so a half-typed number never reaches the store:
 * the store clamps on read, so committing every keystroke would snap the
 * field to `min` while you were still typing (e.g. "1" on the way to "18"),
 * and a momentarily empty field parses as NaN.
 *
 * A draft that is already a valid in-range number commits immediately, which
 * keeps the live preview these settings are for. Anything else waits for
 * blur, where it gets clamped into range.
 */
function NumberControl({
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

  // Re-sync when the value changes from elsewhere (a reset, a workspace switch).
  useEffect(() => setDraft(String(value)), [value]);

  const clamp = (n: number) => {
    let next = n;
    if (def.min !== undefined) next = Math.max(def.min, next);
    if (def.max !== undefined) next = Math.min(def.max, next);
    return next;
  };

  const inRange = (n: number) =>
    Number.isFinite(n) &&
    (def.min === undefined || n >= def.min) &&
    (def.max === undefined || n <= def.max);

  const commit = () => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed) || draft.trim() === '') {
      setDraft(String(value));
      return;
    }
    const next = clamp(parsed);
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
          if (next.trim() !== '' && inRange(parsed) && parsed !== value) {
            onChange(parsed);
          }
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
