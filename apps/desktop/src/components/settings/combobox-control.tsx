import { useEffect, useMemo, useState } from 'react';
import { ChevronsUpDown, X } from 'lucide-react';

import { Button } from '@sunstead/ui/components/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@sunstead/ui/components/command';
import { Popover, PopoverContent, PopoverTrigger } from '@sunstead/ui/components/popover';
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { touchFirst } from '@/lib/backend/platform';
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
  /** What's chosen, heading the sheet it is on a touch screen. */
  title: string;
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
  title,
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

  const trigger = (
    <>
      <span className='truncate' style={current?.preview ? { fontFamily: current.preview } : undefined}>
        {current?.label ?? placeholder}
      </span>
      <ChevronsUpDown className='size-3.5 shrink-0 opacity-50' />
    </>
  );
  const buttonClass = 'h-8 w-full min-w-0 shrink justify-between px-3 text-sm font-normal sm:w-52';

  const list = (
    // On a touch screen the list scrolls under the filter field, which stays put.
    <Command className={touchFirst ? 'min-h-0 flex-1 bg-transparent' : undefined}>
      {searchPlaceholder && <CommandInput placeholder={searchPlaceholder} />}
      <CommandList className={touchFirst ? 'max-h-none min-h-0 flex-1' : 'max-h-72'}>
        <CommandEmpty>{loading ? 'Loading…' : 'Nothing found.'}</CommandEmpty>
        {groups.map((group, index) => (
          <CommandGroup key={group.heading ?? index} heading={group.heading}>
            {group.choices.map((choice) => (
              <CommandItem
                key={choice.value}
                // cmdk filters on this rather than on the rendered node, so
                // it has to carry the text the user would type.
                value={`${choice.label} ${choice.value}`}
                className={touchFirst ? 'min-h-11 w-full text-[17px]' : undefined}
                // The item's own check shows for this; a second one beside it split the row's room and sat mid-row.
                data-checked={choice.value === value}
                onSelect={() => {
                  onChange(choice.value);
                  setOpen(false);
                }}
              >
                <span className='truncate' style={choice.preview ? { fontFamily: choice.preview } : undefined}>
                  {choice.label}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </Command>
  );

  // A touch screen chooses from a sheet, as iOS does, not a popover at the finger.
  if (touchFirst) {
    return (
      <>
        <Button id={id} variant='outline' className={buttonClass} onClick={() => setOpen(true)}>
          {trigger}
        </Button>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent
            side='bottom'
            showCloseButton={false}
            // The filter field waits for a tap: the keyboard coming up with the sheet covered the choices.
            initialFocus={false}
            finalFocus={false}
            className={cn(
              'gap-0 rounded-t-2xl bg-sidebar pb-[env(safe-area-inset-bottom)]',
              // A fixed height where there's a filter, so the sheet doesn't jump as it narrows.
              searchPlaceholder ? 'h-[70dvh]' : 'max-h-[70dvh]',
            )}
          >
            <div className='flex items-center gap-2 px-5 pt-5 pb-2'>
              <SheetTitle className='min-w-0 flex-1 truncate text-[17px] font-semibold'>{title}</SheetTitle>
              <SheetClose className='-mr-1 grid size-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground active:opacity-60'>
                <X className='size-4' />
                <span className='sr-only'>Close</span>
              </SheetClose>
            </div>
            <SheetDescription className='sr-only'>Choose one</SheetDescription>
            {/* Dragging the choices puts the keyboard away, as iOS's lists do. */}
            <div
              className='flex min-h-0 flex-1 flex-col px-2 pb-2'
              onTouchMove={() => {
                if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur();
              }}
            >
              {list}
            </div>
          </SheetContent>
        </Sheet>
      </>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button id={id} variant='outline' className={buttonClass} />}>{trigger}</PopoverTrigger>
      <PopoverContent className='w-64 p-0' align='end'>
        {list}
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
      title={def.label}
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
      title={def.label}
      value={value}
      onChange={onChange}
      groups={groups}
      placeholder='Default'
      searchPlaceholder='Search fonts…'
      loading={families === null}
    />
  );
}
