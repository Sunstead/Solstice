import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { bundledFonts, installedFonts } from '@/lib/theme/fonts';
import { resolveOptions, type FontDef, type SelectDef } from '@/lib/settings/types';

interface Choice {
  value: string;
  label: string;
  /** Renders the row in the family it names, for the font pickers. */
  preview?: string;
}

interface ComboboxProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  groups: { heading?: string; choices: Choice[] }[];
  placeholder: string;
  /** Omitted for short lists, where a filter field is just another thing to skip. */
  searchPlaceholder?: string;
  loading?: boolean;
}

function Combobox({
  id,
  value,
  onChange,
  groups,
  placeholder,
  searchPlaceholder,
  loading,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);

  const current = groups
    .flatMap((group) => group.choices)
    .find((choice) => choice.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            id={id}
            variant='outline'
            className='h-8 w-52 justify-between px-3 text-sm font-normal'
          />
        }
      >
        <span
          className='truncate'
          style={current?.preview ? { fontFamily: current.preview } : undefined}
        >
          {current?.label ?? placeholder}
        </span>
        <ChevronsUpDown className='size-3.5 shrink-0 opacity-50' />
      </PopoverTrigger>
      <PopoverContent className='w-64 p-0' align='end'>
        <Command>
          {searchPlaceholder && <CommandInput placeholder={searchPlaceholder} />}
          <CommandList className='max-h-72'>
            <CommandEmpty>{loading ? 'Loading…' : 'Nothing found.'}</CommandEmpty>
            {groups.map((group, index) => (
              <CommandGroup key={group.heading ?? index} heading={group.heading}>
                {group.choices.map((choice) => (
                  <CommandItem
                    key={choice.value}
                    // cmdk filters on this rather than on the rendered node, so
                    // it has to carry the text the user would type.
                    value={`${choice.label} ${choice.value}`}
                    onSelect={() => {
                      onChange(choice.value);
                      setOpen(false);
                    }}
                  >
                    <span
                      className='truncate'
                      style={choice.preview ? { fontFamily: choice.preview } : undefined}
                    >
                      {choice.label}
                    </span>
                    <Check
                      className={cn(
                        'ml-auto size-3.5',
                        choice.value === value ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function SelectControl({
  def,
  value,
  onChange,
  id,
}: {
  def: SelectDef;
  value: string;
  onChange: (value: string) => void;
  id: string;
}) {
  const choices = resolveOptions(def.options);

  return (
    <Combobox
      id={id}
      value={value}
      onChange={onChange}
      groups={[{ choices: [...choices] }]}
      placeholder='Choose…'
      searchPlaceholder={choices.length > 8 ? 'Search…' : undefined}
    />
  );
}

/** Quoted so a family whose name contains spaces or digits still resolves. */
const preview = (family: string) => `'${family.replace(/'/g, "\\'")}'`;

export function FontControl({
  def,
  value,
  onChange,
  id,
}: {
  def: FontDef;
  value: string;
  onChange: (value: string) => void;
  id: string;
}) {
  const [families, setFamilies] = useState<string[] | null>(null);

  // Enumerating installed families walks the system font directories, so it
  // waits until a picker is actually rendered rather than running at startup.
  useEffect(() => {
    let live = true;
    installedFonts().then((list) => live && setFamilies(list));
    return () => {
      live = false;
    };
  }, []);

  const groups = useMemo(() => {
    const bundled = bundledFonts
      // The suggestion filter is a hint about what this setting is for, not a
      // restriction: every installed family stays available below.
      .filter((font) => !def.suggest || font.kind === def.suggest)
      .map((font) => ({
        value: font.family,
        label: font.label,
        preview: preview(font.family),
      }));

    const bundledFamilies = new Set(bundledFonts.map((font) => font.family));
    const installed = (families ?? [])
      .filter((family) => !bundledFamilies.has(family))
      .map((family) => ({
        value: family,
        label: family,
        preview: preview(family),
      }));

    return [
      { choices: [{ value: '', label: 'Default' }] },
      { heading: 'Bundled', choices: bundled },
      { heading: 'Installed', choices: installed },
    ].filter((group) => group.choices.length > 0);
  }, [def.suggest, families]);

  return (
    <Combobox
      id={id}
      value={value}
      onChange={onChange}
      groups={groups}
      placeholder='Default'
      searchPlaceholder='Search fonts…'
      loading={families === null}
    />
  );
}
