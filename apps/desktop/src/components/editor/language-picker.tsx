import { useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';

import { Button } from '@sunstead/ui/components/button';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@sunstead/ui/components/command';
import { Popover, PopoverContent, PopoverTrigger } from '@sunstead/ui/components/popover';
import { languageLabel, languageNames } from '@/lib/codeblock/languages';
import { cn } from '@/lib/utils';

/** Shown for no language, and the entry that clears one. */
const PLAIN_TEXT = 'plain text';

/** A language by name, `''` for plain text: a code block's or a code tab's. */
export function LanguagePicker({ value, onChange }: { value: string; onChange: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant='ghost' size='xs' className='font-mono'>
            {value ? languageLabel(value) : PLAIN_TEXT}
            <ChevronsUpDown />
          </Button>
        }
      />
      <PopoverContent align='start' className='w-56 p-0'>
        <Command>
          <CommandInput placeholder='Language…' />
          <CommandList>
            <CommandEmpty>No language found.</CommandEmpty>
            {[PLAIN_TEXT, ...languageNames].map((name) => (
              <CommandItem
                key={name}
                value={name}
                onSelect={() => {
                  onChange(name === PLAIN_TEXT ? '' : name);
                  setOpen(false);
                }}
              >
                <Check className={cn('size-3.5', (value || PLAIN_TEXT) === name ? 'opacity-100' : 'opacity-0')} />
                {languageLabel(name)}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
