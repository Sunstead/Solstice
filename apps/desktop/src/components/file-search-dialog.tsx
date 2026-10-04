import { ReactNode } from 'react';

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@sunstead/ui/components/command';
import { FileEntry } from '@/bindings';

type FileSearchDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  placeholder: string;
  emptyMessage: string;
  heading?: string;
  entries: FileEntry[];
  onSelect: (entry: FileEntry) => void;
  renderItem: (entry: FileEntry) => ReactNode;
};

/**
 * Generic "search the workspace, pick one entry" dialog. Both quick-open
 * (files) and the move-to-folder picker (folders) are thin wrappers around
 * this — same interaction shape, different predicate/renderItem/onSelect.
 *
 * NOTE: this project's `CommandDialog` does NOT render the `<Command>` root
 * internally (unlike stock shadcn) — it's just a `Dialog` wrapper, so the
 * `<Command>` primitive must be rendered explicitly here or cmdk's internal
 * store context is undefined and `CommandInput` crashes.
 *
 * Filtering is left to cmdk's default fuzzy matcher via `value`; swap in a
 * custom `filter` prop on `<Command>` later if the default ranking feels
 * off in practice (e.g. weighting name matches over path matches).
 */
export function FileSearchDialog({
  open,
  onOpenChange,
  placeholder,
  emptyMessage,
  heading,
  entries,
  onSelect,
  renderItem,
}: FileSearchDialogProps) {
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      className='sm:max-w-2xl'
    >
      <Command>
        <CommandInput placeholder={placeholder} />
        <CommandList>
          <CommandEmpty>{emptyMessage}</CommandEmpty>
          <CommandGroup heading={heading}>
            {entries.map((entry) => (
              <CommandItem
                key={entry.path}
                value={entry.path}
                onSelect={() => {
                  onSelect(entry);
                  onOpenChange(false);
                }}
              >
                {renderItem(entry)}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
