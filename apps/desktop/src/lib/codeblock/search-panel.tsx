import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { EditorView, Panel } from '@codemirror/view';
import { runScopeHandlers } from '@codemirror/view';
import {
  SearchQuery,
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  replaceAll,
  replaceNext,
  selectMatches,
  setSearchQuery,
} from '@codemirror/search';
import {
  CaseSensitive,
  ChevronDown,
  ChevronUp,
  Regex,
  Replace,
  ReplaceAll,
  WholeWord,
  X,
} from 'lucide-react';

import { Button } from '@sunstead/ui/components/button';
import { Input } from '@sunstead/ui/components/input';

interface QueryFields {
  search: string;
  replace: string;
  caseSensitive: boolean;
  regexp: boolean;
  wholeWord: boolean;
}

function toFields(query: SearchQuery): QueryFields {
  return {
    search: query.search,
    replace: query.replace,
    caseSensitive: query.caseSensitive,
    regexp: query.regexp,
    wholeWord: query.wholeWord,
  };
}

function ToggleButton({
  active,
  title,
  onClick,
  children,
}: {
  active: boolean;
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      type='button'
      size='icon-xs'
      variant={active ? 'default' : 'ghost'}
      title={title}
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

/**
 * Listeners a panel instance's `update()` calls into, keyed by the view they
 * belong to. `update()` runs outside React, so this is how an external
 * `setSearchQuery` effect -- `openSearchPanel` re-seeding the query from the
 * selection when Mod-f is pressed a second time -- reaches the component
 * that owns the fields.
 */
const externalUpdates = new WeakMap<EditorView, Set<(query: SearchQuery) => void>>();

function SearchPanelRoot({ view }: { view: EditorView }) {
  // The query lives in CodeMirror's own state, not React's; this is a
  // controlled view onto it. `queryRef` mirrors the last dispatched value so
  // `commit` and the external-update listener can both compare against it
  // without a stale closure.
  const initial = getSearchQuery(view.state);
  const [fields, setFields] = useState<QueryFields>(() => toFields(initial));
  const queryRef = useRef(initial);
  const searchRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);

  const commit = (next: QueryFields) => {
    setFields(next);
    const query = new SearchQuery(next);
    if (!query.eq(queryRef.current)) {
      queryRef.current = query;
      view.dispatch({ effects: setSearchQuery.of(query) });
    }
  };

  useEffect(() => {
    const listener = (query: SearchQuery) => {
      if (query.eq(queryRef.current)) return;
      queryRef.current = query;
      setFields(toFields(query));
    };
    externalUpdates.get(view)?.add(listener);
    return () => void externalUpdates.get(view)?.delete(listener);
  }, [view]);

  // Matches the vanilla panel's own `mount()`: focus and select the query so
  // typing immediately replaces it. `main-field` is CodeMirror's own hook
  // (searched for by `getSearchInput`) for refocusing this same input when
  // the panel is already open and Mod-f is pressed again.
  useEffect(() => {
    searchRef.current?.setAttribute('main-field', 'true');
    searchRef.current?.focus();
    searchRef.current?.select();
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Keeps `searchKeymap` (F3, Mod-g, ...) working while focus is inside the
    // panel rather than the editor.
    if (runScopeHandlers(view, event.nativeEvent, 'search-panel')) {
      event.preventDefault();
      return;
    }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (event.target === replaceRef.current) replaceNext(view);
    else (event.shiftKey ? findPrevious : findNext)(view);
  };

  return (
    <div className='flex flex-col gap-1 p-1.5' onKeyDown={onKeyDown}>
      <div className='flex items-center gap-1'>
        <Input
          ref={searchRef}
          value={fields.search}
          onChange={(e) => commit({ ...fields, search: e.target.value })}
          placeholder='Find'
          aria-label='Find'
          className='h-7 flex-1 px-2 text-xs'
        />
        <Button
          type='button'
          size='icon-xs'
          variant='ghost'
          title='Previous match'
          onClick={() => findPrevious(view)}
        >
          <ChevronUp />
        </Button>
        <Button
          type='button'
          size='icon-xs'
          variant='ghost'
          title='Next match'
          onClick={() => findNext(view)}
        >
          <ChevronDown />
        </Button>
        <div className='mx-0.5 flex items-center gap-0.5'>
          <ToggleButton
            active={fields.caseSensitive}
            title='Match case'
            onClick={() => commit({ ...fields, caseSensitive: !fields.caseSensitive })}
          >
            <CaseSensitive />
          </ToggleButton>
          <ToggleButton
            active={fields.wholeWord}
            title='Match whole word'
            onClick={() => commit({ ...fields, wholeWord: !fields.wholeWord })}
          >
            <WholeWord />
          </ToggleButton>
          <ToggleButton
            active={fields.regexp}
            title='Use regular expression'
            onClick={() => commit({ ...fields, regexp: !fields.regexp })}
          >
            <Regex />
          </ToggleButton>
        </div>
        <Button
          type='button'
          size='xs'
          variant='ghost'
          title='Select all matches'
          onClick={() => selectMatches(view)}
        >
          All
        </Button>
        <Button
          type='button'
          size='icon-xs'
          variant='ghost'
          title='Close'
          className='ml-auto'
          onClick={() => closeSearchPanel(view)}
        >
          <X />
        </Button>
      </div>

      {!view.state.readOnly && (
        <div className='mt-1 flex items-center gap-1'>
          <Input
            ref={replaceRef}
            value={fields.replace}
            onChange={(e) => commit({ ...fields, replace: e.target.value })}
            placeholder='Replace'
            aria-label='Replace'
            className='h-7 flex-1 px-2 text-xs'
          />
          <Button
            type='button'
            size='icon-xs'
            variant='ghost'
            title='Replace'
            onClick={() => replaceNext(view)}
          >
            <Replace />
          </Button>
          <Button
            type='button'
            size='icon-xs'
            variant='ghost'
            title='Replace all'
            onClick={() => replaceAll(view)}
          >
            <ReplaceAll />
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * A `createPanel` for `@codemirror/search` that renders real shadcn
 * components instead of the package's own bare `<input>`/`<button>` markup.
 */
export function createSearchPanel(view: EditorView): Panel {
  const dom = document.createElement('div');
  externalUpdates.set(view, new Set());

  const root = createRoot(dom);
  root.render(<SearchPanelRoot view={view} />);

  return {
    dom,
    top: false,
    update(update) {
      const listeners = externalUpdates.get(view);
      if (!listeners) return;

      for (const tr of update.transactions) {
        for (const effect of tr.effects) {
          if (effect.is(setSearchQuery)) {
            for (const listener of listeners) listener(effect.value);
          }
        }
      }
    },
    destroy() {
      externalUpdates.delete(view);
      root.unmount();
    },
  };
}
