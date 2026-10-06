import { useEffect, useRef } from 'react';
import { CaseSensitive, ChevronDown, ChevronUp, WholeWord, X } from 'lucide-react';

import { Button } from '@sunstead/ui/components/button';
import { Input } from '@sunstead/ui/components/input';
import { useFindStore } from '@/lib/stores/find';
import { cn } from '@/lib/utils';

type FindBarProps = {
  onClose: () => void;
};

/**
 * Find-in-file for one editor. It owns none of the searching: the query and
 * flags live in `useFindStore`, and the editor's ProseMirror plugin turns them
 * into highlights and reports the counts back.
 *
 * A floating panel rather than a bar in the flow, so opening it never reflows
 * the document out from under the match the user is looking at. It is anchored
 * to the editor's header, which does not scroll; this component only draws it.
 */
export function FindBar({ onClose }: FindBarProps) {
  const query = useFindStore((s) => s.query);
  const setQuery = useFindStore((s) => s.setQuery);
  const caseSensitive = useFindStore((s) => s.caseSensitive);
  const wholeWord = useFindStore((s) => s.wholeWord);
  const toggleCaseSensitive = useFindStore((s) => s.toggleCaseSensitive);
  const toggleWholeWord = useFindStore((s) => s.toggleWholeWord);
  const matchCount = useFindStore((s) => s.matchCount);
  const activeIndex = useFindStore((s) => s.activeIndex);
  const step = useFindStore((s) => s.step);
  const focusNonce = useFindStore((s) => s.focusNonce);

  const inputRef = useRef<HTMLInputElement>(null);

  // Keyed on the open counter rather than on mount, so asking for find again
  // while the bar is already up re-focuses it instead of doing nothing.
  // Deferred a frame because the editor seeds the query from its selection in
  // an effect of its own, and this has to select whatever that leaves behind.
  useEffect(() => {
    const frame = requestAnimationFrame(() => inputRef.current?.select());
    return () => cancelAnimationFrame(frame);
  }, [focusNonce]);

  const empty = query.length > 0 && matchCount === 0;

  return (
    <div className='flex w-max items-center gap-0.5 rounded-xl border bg-popover py-1 pr-1 pl-1 shadow-lg backdrop-blur-xl backdrop-saturate-150 animate-in fade-in-0 slide-in-from-top-1'>
      <div className='relative flex items-center'>
        <Input
          ref={inputRef}
          value={query}
          autoFocus
          placeholder='Find in file'
          aria-label='Find in file'
          className={cn('h-8 w-52 pr-30 sm:w-64', empty && 'text-destructive')}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              step(event.shiftKey ? -1 : 1);
            } else if (event.key === 'Escape') {
              event.preventDefault();
              onClose();
            }
          }}
        />

        <div className='absolute right-1 flex items-center gap-0.5'>
          <span className='px-1 text-xs tabular-nums text-muted-foreground'>
            {matchCount === 0
              ? query
                ? 'No results'
                : ''
              : `${activeIndex + 1}/${matchCount}`}
          </span>
          {/*
            Swapping the whole variant rather than layering an active class
            over `ghost`: `bg-muted` sits a hair off the panel's own fill, so
            an enabled toggle read as disabled. `default` is the one token
            pair guaranteed to contrast with the surface it sits on.
          */}
          <Button
            size='icon-xs'
            variant={caseSensitive ? 'default' : 'ghost'}
            aria-label='Match case'
            aria-pressed={caseSensitive}
            onClick={toggleCaseSensitive}
          >
            <CaseSensitive />
          </Button>
          <Button
            size='icon-xs'
            variant={wholeWord ? 'default' : 'ghost'}
            aria-label='Match whole word'
            aria-pressed={wholeWord}
            onClick={toggleWholeWord}
          >
            <WholeWord />
          </Button>
        </div>
      </div>

      <Button
        size='icon-sm'
        variant='ghost'
        aria-label='Previous match'
        disabled={matchCount === 0}
        onClick={() => step(-1)}
      >
        <ChevronUp />
      </Button>
      <Button
        size='icon-sm'
        variant='ghost'
        aria-label='Next match'
        disabled={matchCount === 0}
        onClick={() => step(1)}
      >
        <ChevronDown />
      </Button>
      <Button size='icon-sm' variant='ghost' aria-label='Close find' onClick={onClose}>
        <X />
      </Button>
    </div>
  );
}
