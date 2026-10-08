import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@sunstead/ui/components/command';
import { QuickOpenItem } from '@/components/quick-open-dialog';
import { useLayout } from '@/hooks/use-layout';
import { useWorkspace } from '@/hooks/use-workspace';
import { getFileNameFromPath } from '@/lib/path-utils';
import { useRecentFiles } from '@/lib/stores/recent-files';
import { selectAllFiles, useFileIndex } from '@/lib/stores/use-file-index';
import { PhoneHeader, PhoneTitle } from './phone-parts';

const ITEM = 'min-h-12 rounded-lg px-3';

/**
 * Quick open as a page: the field at the top (the keyboard comes up with it)
 * and the matches below, or the files opened lately before anything's typed.
 */
export function SearchPage() {
  const root = useWorkspace((s) => s.path);
  const files = useFileIndex(useShallow(selectAllFiles));
  const recentPaths = useRecentFiles((s) => s.paths);
  const [query, setQuery] = useState('');

  const known = new Set(files.map((f) => f.path));
  const recent = recentPaths.filter((p) => known.has(p));
  const open = (path: string) => useLayout.getState().openFile(path, getFileNameFromPath(path));

  return (
    <div className='absolute inset-0 flex flex-col bg-background'>
      <PhoneHeader>
        <PhoneTitle>Search</PhoneTitle>
      </PhoneHeader>
      {root ? (
        <Command className='min-h-0 flex-1 rounded-none! bg-transparent p-2'>
          <CommandInput
            placeholder='Search files'
            value={query}
            onValueChange={setQuery}
            autoFocus
            autoCapitalize='off'
            autoCorrect='off'
            spellCheck={false}
            enterKeyHint='search'
          />
          <CommandList className='max-h-none flex-1 pt-2'>
            {query ? (
              <>
                <CommandEmpty>No matching files.</CommandEmpty>
                <CommandGroup>
                  {files.map((entry) => (
                    <CommandItem key={entry.path} value={entry.path} className={ITEM} onSelect={() => open(entry.path)}>
                      <QuickOpenItem entry={entry} root={root} />
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            ) : recent.length > 0 ? (
              <CommandGroup heading='Recent'>
                {recent.map((path) => (
                  <CommandItem key={path} value={path} className={ITEM} onSelect={() => open(path)}>
                    <QuickOpenItem entry={{ path, name: getFileNameFromPath(path) }} root={root} />
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : (
              <p className='py-10 text-center text-sm text-muted-foreground'>Type to find a file.</p>
            )}
          </CommandList>
        </Command>
      ) : (
        <p className='py-10 text-center text-sm text-muted-foreground'>No workspace open</p>
      )}
    </div>
  );
}
