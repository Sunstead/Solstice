import {
  createElement,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { CaseSensitive, Check, ChevronRight, WholeWord } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { Button } from '@sunstead/ui/components/button';
import { Input } from '@sunstead/ui/components/input';
import type { FileHits, Hit, Jump } from '@/bindings';
import { getFileIconFor } from '@/assets/icons';
import { EntryMenuTrigger } from '@/components/entry-menu-trigger';
import { FormattedFileName } from '@/components/file-tree';
import { useLayout } from '@/hooks/use-layout';
import { getFileNameFromPath, getRelativePath } from '@/lib/path-utils';
import { openSearchHit } from '@/lib/search/jump';
import { matchNames, type NameMatch } from '@/lib/search/names';
import { useSetting } from '@/lib/settings/store';
import { touchFirst } from '@/lib/backend/platform';
import { useScrollEdge } from '@/lib/scroll-edge';
import { TabBarRoom } from '@/components/mobile/tab-bar-room';
import { parseExcludes, useSearchStore } from '@/lib/stores/search';
import { selectAllFiles, useFileIndex } from '@/lib/stores/use-file-index';
import { cn } from '@/lib/utils';

/** Name matches shown before "Show all". */
const NAMES = 5;
const NAMES_ALL = 50;
/** How long typing has to pause before a search. */
const DEBOUNCE_MS = 200;

const ROW =
  'flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-sidebar-accent touch:py-2';

const open = (path: string) =>
  useLayout.getState().openFile(path, getFileNameFromPath(path));

/**
 * Full-text search of the workspace: the field and its two options, files
 * whose names match, then every file whose insides do, each hit a line that
 * opens the file there. The sidebar's Search view and the phone's Search page.
 * `empty` shows before anything's typed. `bar` is the phone's page, where
 * the field is the bottom of its top bar: the fade of results scrolling
 * under it hangs below the field, not across it.
 */
export function SearchView({
  root,
  empty,
  bar = false,
}: {
  root: string;
  empty?: ReactNode;
  bar?: boolean;
}) {
  useSearchRunner(root);
  const query = useSearchStore((s) => s.query);
  const results = useSearchStore((s) => s.results);
  const pending = useSearchStore((s) => s.pending);
  const error = useSearchStore((s) => s.error);
  const edge = useScrollEdge('top');

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <div ref={bar ? edge : undefined} className={cn('px-2 pb-2', bar && 'phone-bar bg-background')}>
        <SearchField />
      </div>
      {/* Dragging the results puts the keyboard away, as iOS's lists do. */}
      <div className='min-h-0 flex-1 overflow-y-auto px-2 pb-4' onTouchMove={touchFirst ? blurField : undefined}>
        {!query ? (
          (empty ?? <span />)
        ) : (
          <>
            <NameMatches root={root} />
            <Summary results={results} pending={pending} error={error} />
            {results?.files.map((file) => (
              <FileGroup key={file.path} file={file} root={root} />
            ))}
            {results?.truncated && (
              <p className='px-2 py-3 text-xs text-muted-foreground'>
                Not every result is shown. Search for something longer to narrow
                it down.
              </p>
            )}
          </>
        )}
        <TabBarRoom />
      </div>
    </div>
  );
}

/** Searches as the query, its options, the excluded folders or the files change. */
function useSearchRunner(root: string) {
  const query = useSearchStore((s) => s.query);
  const caseSensitive = useSearchStore((s) => s.caseSensitive);
  const wholeWord = useSearchStore((s) => s.wholeWord);
  const exclude = useSetting('search.exclude');
  // Any file added, changed or removed: the backend reads only what changed.
  const files = useFileIndex((s) => s.files);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void useSearchStore.getState().run(root, parseExcludes(exclude));
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [root, query, caseSensitive, wholeWord, exclude, files]);
}

function blurField() {
  const field = document.activeElement;
  if (field instanceof HTMLInputElement && field.dataset.searchField !== undefined) field.blur();
}

function SearchField() {
  const query = useSearchStore((s) => s.query);
  const setQuery = useSearchStore((s) => s.setQuery);
  const caseSensitive = useSearchStore((s) => s.caseSensitive);
  const wholeWord = useSearchStore((s) => s.wholeWord);
  const toggleCaseSensitive = useSearchStore((s) => s.toggleCaseSensitive);
  const toggleWholeWord = useSearchStore((s) => s.toggleWholeWord);
  const focusNonce = useSearchStore((s) => s.focusNonce);
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);

  // Find in Files: a frame later, once the view it switched to has mounted.
  useEffect(() => {
    if (focusNonce === 0) return;
    const frame = requestAnimationFrame(() => inputRef.current?.select());
    return () => cancelAnimationFrame(frame);
  }, [focusNonce]);

  return (
    <div className='flex items-center gap-2'>
      <div className='relative flex min-w-0 flex-1 items-center'>
        <Input
          ref={inputRef}
          data-search-field
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          value={query}
          placeholder='Search'
          aria-label='Search in files'
          autoCapitalize='off'
          autoCorrect='off'
          spellCheck={false}
          enterKeyHint='search'
          className='h-8 pr-16 touch:h-10'
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && query) {
              event.preventDefault();
              setQuery('');
            }
          }}
        />
        {/* As the find bar has them, so they read the same. */}
        <div className='absolute right-1 flex items-center gap-0.5'>
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
      {/* Puts the keyboard away, keeping the query: a check, as iOS's own
          Done is now, rather than Cancel's clearing. */}
      {touchFirst && focused && (
        <button
          type='button'
          aria-label='Done'
          className='flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-foreground active:opacity-60'
          // Kept from taking focus, or the field's blur would unmount it mid-tap.
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => inputRef.current?.blur()}
        >
          <Check className='size-5' strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
}

function Summary({
  results,
  pending,
  error,
}: {
  results: ReturnType<typeof useSearchStore.getState>['results'];
  pending: boolean;
  error: string | null;
}) {
  let text: string;
  if (error) text = `Couldn't search: ${error}`;
  else if (!results) text = pending ? 'Searching…' : '';
  else if (results.total === 0) text = 'No results in files.';
  else
    text = `${count(results.total, 'result')} in ${count(results.files.length, 'file')}`;
  if (!text) return null;
  return (
    <p
      className={cn(
        'select-text px-2 pt-3 pb-1 text-xs text-muted-foreground',
        error && 'text-destructive',
        pending && results && 'opacity-60',
      )}
    >
      {text}
    </p>
  );
}

const count = (n: number, noun: string) =>
  `${n.toLocaleString()} ${noun}${n === 1 ? '' : 's'}`;

function NameMatches({ root }: { root: string }) {
  const files = useFileIndex(useShallow(selectAllFiles));
  const query = useSearchStore((s) => s.query);
  const caseSensitive = useSearchStore((s) => s.caseSensitive);
  const wholeWord = useSearchStore((s) => s.wholeWord);
  const [all, setAll] = useState(false);
  const { matches, total } = matchNames(
    files,
    query,
    { caseSensitive, wholeWord },
    all ? NAMES_ALL : NAMES,
  );
  if (total === 0) return null;

  return (
    <section className='pb-1'>
      <p className='px-2 pt-1 pb-1 text-xs font-medium text-muted-foreground'>
        Files
      </p>
      {matches.map((match) => (
        <NameRow key={match.entry.path} match={match} root={root} />
      ))}
      {total > matches.length && (
        <button
          type='button'
          className={cn(ROW, 'text-xs text-muted-foreground')}
          onClick={() => setAll(true)}
        >
          Show {all ? `the first ${NAMES_ALL}` : `all ${total}`}
        </button>
      )}
    </section>
  );
}

function NameRow({ match, root }: { match: NameMatch; root: string }) {
  const { entry } = match;
  return (
    <EntryMenuTrigger
      entry={entry}
      render={
        <button type='button' className={ROW} onClick={() => open(entry.path)}>
          {createElement(getFileIconFor(entry.name), {
            className: 'size-4 shrink-0',
          })}
          <span className='min-w-0 truncate'>
            <FormattedFileName name={entry.name} />
          </span>
          <span className='min-w-0 flex-1 truncate text-xs text-muted-foreground'>
            {folderOf(entry.path, root)}
          </span>
        </button>
      }
    />
  );
}

/** The folder a file is in, from the workspace's root; empty at the root. */
function folderOf(path: string, root: string): string {
  const relative = getRelativePath(path, root);
  return relative.split('/').slice(0, -1).join('/');
}

function FileGroup({ file, root }: { file: FileHits; root: string }) {
  const [collapsed, setCollapsed] = useState(false);
  const name = getFileNameFromPath(file.path);
  const more = file.count - file.hits.length;

  return (
    // Off-screen groups skip layout and paint: thousands of rows stay cheap.
    <section className='[content-visibility:auto] [contain-intrinsic-size:auto_6rem]'>
      <EntryMenuTrigger
        entry={{ path: file.path, name, is_dir: false }}
        render={
          <button
            type='button'
            className={ROW}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed(!collapsed)}
          >
            <ChevronRight
              className={cn(
                'size-3.5 shrink-0 text-muted-foreground transition-transform',
                !collapsed && 'rotate-90',
              )}
            />
            {createElement(getFileIconFor(name), { className: 'size-4 shrink-0' })}
            <span className='min-w-0 truncate font-medium'>
              <FormattedFileName name={name} />
            </span>
            <span className='min-w-0 flex-1 truncate text-xs text-muted-foreground'>
              {folderOf(file.path, root)}
            </span>
            <span className='shrink-0 rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground'>
              {file.count}
            </span>
          </button>
        }
      />
      {!collapsed && (
        <div className='pl-5'>
          {file.hits.map((hit, index) => (
            <HitRow key={index} path={file.path} hit={hit} />
          ))}
          {more > 0 && (
            <p className='px-2 py-1 text-xs text-muted-foreground'>
              {count(more, 'more result')} in this file
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function HitRow({ path, hit }: { path: string; hit: Hit }) {
  const [start, end] = hit.range;
  const place = placeLabel(hit.jump);
  const onClick = () => {
    const { query, caseSensitive, wholeWord } = useSearchStore.getState();
    openSearchHit(
      path,
      hit.jump,
      end - start,
      { text: query, case_sensitive: caseSensitive, whole_word: wholeWord },
      open,
    );
  };

  return (
    <button
      type='button'
      className={cn(ROW, 'items-baseline')}
      onClick={onClick}
    >
      <span className='min-w-0 flex-1 truncate text-muted-foreground'>
        {hit.preview.slice(0, start)}
        <mark className='rounded-sm bg-primary/25 text-foreground'>
          {hit.preview.slice(start, end)}
        </mark>
        {hit.preview.slice(end)}
      </span>
      {place && (
        <span className='shrink-0 text-xs text-muted-foreground'>{place}</span>
      )}
    </button>
  );
}

/** Where a hit is, for those not in a note's text. */
function placeLabel(jump: Jump): string | null {
  switch (jump.type) {
    case 'line':
      return null;
    case 'card':
      return 'Card';
    case 'page':
      return jump.ink
        ? `Handwriting, p. ${jump.page + 1}`
        : `p. ${jump.page + 1}`;
    case 'handwriting':
      return 'Handwriting';
  }
}
