import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Actions, type Model } from 'flexlayout-react';
import { Bookmark, Files, Search } from 'lucide-react';

import { useAccountActions } from '@/hooks/use-account-actions';
import { BlankTab } from '@/components/blank-tab';
import { TabContent } from '@/components/tab-content';
import { UserAvatar } from '@/components/user-avatar';
import { useKeyboard } from '@/lib/keyboard';
import { useLayout } from '@/hooks/use-layout';
import { useLayoutSession } from '@/hooks/use-layout-session';
import { useWorkspace } from '@/hooks/use-workspace';
import { registerCommand, unregisterCommand } from '@/lib/commands';
import { can, touchFirst } from '@/lib/backend/platform';
import { nativeTabBar, type TabBarItem } from '@/lib/backend/native';
import { initials } from '@/lib/initials';
import { webOverlayOpen } from '@/lib/native-surfaces';
import { useEntryInput } from '@/lib/stores/entry-input';
import { usePhoneNav, type PhonePage } from '@/lib/stores/phone-nav';
import { useRevealTarget } from '@/lib/stores/reveal-target';
import { useSettingsDialog } from '@/lib/stores/settings-dialog';
import { cn } from '@/lib/utils';
import { FilesPage } from './files-page';
import { NoteHeader } from './note-pane';
import { EntrySheet } from './entry-sheet';
import { tabPath } from './phone-history';
import { PushPane } from './push-pane';
import { BookmarksPage } from './bookmarks-page';
import { SearchPage } from './search-page';
import { allTabs, shownTab } from './tabs';
import { useScrollEdge } from '@/lib/scroll-edge';
import { followDynamicType } from '@/lib/dynamic-type';
import { YouPage } from './you-page';

/**
 * The app on a phone (and in a desktop window that narrow), the way Discord
 * does it: the files are home, full screen, with Files, Bookmarks, Search and You in a
 * footer; a note slides in over them from the right, and goes back by its
 * Back button or a swipe from the left edge.
 *
 * The note is the shown tab of the same flexlayout model the desktop draws
 * as tabs and splits, so they survive a trip through here. A file opened here
 * replaces the note that was showing (`openInPlace`) rather than piling up
 * tabs nobody sees; the tab switcher still has them all.
 */
export function PhoneShell() {
  const model = useLayout((s) => s.model);
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const handleModelChange = useLayoutSession();
  const page = usePhoneNav((s) => s.page);
  const noteOpen = usePhoneNav((s) => s.noteOpen);
  const goHome = usePhoneNav((s) => s.goHome);
  const home = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!model) return;
    const listener = () => {
      handleModelChange(model);
      redraw();
      if (!can.tabs) queueMicrotask(() => keepOnlyShown(model));
    };
    model.addChangeListener(listener);
    if (!can.tabs) keepOnlyShown(model);
    return () => model.removeChangeListener(listener);
  }, [model, handleModelChange]);

  useEffect(() => {
    useLayout.getState().setOpenInPlace(true);
    return () => useLayout.getState().setOpenInPlace(false);
  }, []);

  const workspace = useWorkspace((s) => s.path);
  useEffect(() => usePhoneNav.getState().reset(), [workspace]);

  // The phone has one look: Islands and its gaps are the window's
  // (`islands:` and `islands.css` skip it). Its type follows Dynamic Type.
  useLayoutEffect(() => {
    document.documentElement.setAttribute('data-phone-layout', '');
    const stopFollowing = touchFirst ? followDynamicType() : () => {};
    return () => {
      stopFollowing();
      document.documentElement.removeAttribute('data-phone-layout');
    };
  }, []);

  const shown = model ? shownTab(model) : null;
  const shownId = shown?.getId();
  const shownPath = tabPath(shown);

  // Opening something (a file, a search result, a link) shows it. Not what
  // the layout restored at launch: that starts on the files.
  const seen = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (seen.current !== undefined && shownId !== undefined && shownId !== seen.current) {
      usePhoneNav.getState().showNote();
    }
    seen.current = shownId;
  }, [shownId]);

  // Opening the note already showing changes nothing in the layout: this does.
  const opened = useLayout((s) => s.opened);
  const openedAtMount = useRef(opened);
  useEffect(() => {
    if (opened !== openedAtMount.current) usePhoneNav.getState().showNote();
  }, [opened]);

  // Leaving a note for another is a step to go back through.
  const lastPath = useRef<string | null>(null);
  useEffect(() => {
    if (lastPath.current && shownPath && lastPath.current !== shownPath) usePhoneNav.getState().left(lastPath.current);
    if (shownPath) lastPath.current = shownPath;
  }, [shownPath]);

  // Finding a file in the tree happens on the files. (Naming one is a
  // dialog on a touch screen; a narrow desktop window names in the tree.)
  const naming = useEntryInput((s) => !touchFirst && s.operation !== null);
  const revealing = useRevealTarget((s) => s.nonce);
  useEffect(() => {
    if (!naming && !revealing) return;
    usePhoneNav.getState().showPage('files');
    usePhoneNav.getState().goHome();
  }, [naming, revealing]);

  // Settings are You's pages here, not a dialog.
  useEffect(
    () =>
      useSettingsDialog.subscribe((state) => {
        if (!state.open) return;
        const nav = usePhoneNav.getState();
        nav.goHome();
        nav.showPage('you');
        if (state.requested) nav.pushSection(state.requested);
        state.close();
      }),
    [],
  );

  useEffect(() => {
    registerCommand('view.toggle_sidebar', () => usePhoneNav.getState().goHome());
    return () => unregisterCommand('view.toggle_sidebar');
  }, []);

  const swipe = useSwipeToNote(!!model);

  return (
    <div className='relative h-full w-full overflow-hidden bg-background'>
      <div ref={home} className='absolute inset-0 flex flex-col' {...swipe}>
        <div className='relative min-h-0 flex-1'>
          <FilesPage hidden={page !== 'files'} />
          {page === 'bookmarks' && <BookmarksPage />}
          {page === 'search' && <SearchPage />}
          {page === 'you' && <YouPage />}
        </div>
        {can.nativeTabBar ? <NativeFooter /> : <AppFooter />}
      </div>
      {model && (
        <PushPane open={noteOpen} onClose={goHome} behind={home} keepMounted>
          <NoteHeader shown={shown} />
          <div className='relative min-h-0 flex-1 bg-background'>
            {shown ? <TabContent key={shownId} node={shown} /> : <BlankTab tabId='' />}
          </div>
        </PushPane>
      )}
      <EntrySheet />
    </div>
  );
}

/**
 * The iPhone shows one note at a time (`can.tabs`): whatever else the model
 * holds (restored from a wider window, opened in a new tab) goes. Only the
 * shown tab is ever mounted here, so nothing unsaved goes with them.
 */
function keepOnlyShown(model: Model) {
  const shown = shownTab(model);
  for (const tab of allTabs(model)) {
    if (tab !== shown) model.doAction(Actions.deleteTab(tab.getId()));
  }
}

/**
 * A swipe left on the files brings back the note, as Discord's does. Only
 * sideways drags are the app's (`touch-action: pan-y`); scrolling stays the
 * browser's.
 */
function useSwipeToNote(enabled: boolean) {
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const swiped = useRef(false);
  if (!enabled) return {};
  return {
    style: { touchAction: 'pan-y' },
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse') return;
      start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
      swiped.current = false;
    },
    onPointerMove: (e: React.PointerEvent) => {
      const s = start.current;
      if (!s || s.id !== e.pointerId) return;
      const dx = s.x - e.clientX;
      if (Math.abs(e.clientY - s.y) > Math.abs(dx)) {
        start.current = null;
        return;
      }
      if (dx > 60) {
        start.current = null;
        swiped.current = true;
        usePhoneNav.getState().showNote();
      }
    },
    onPointerUp: () => {
      start.current = null;
    },
    // The row under a swipe mustn't also take it as a tap.
    onClickCapture: (e: React.MouseEvent) => {
      if (!swiped.current) return;
      swiped.current = false;
      e.stopPropagation();
      e.preventDefault();
    },
  };
}

const PAGES: { id: PhonePage; label: string; icon: typeof Files }[] = [
  { id: 'files', label: 'Files', icon: Files },
  { id: 'bookmarks', label: 'Bookmarks', icon: Bookmark },
  { id: 'search', label: 'Search', icon: Search },
];

/**
 * Tapping the tab already shown, as UIKit's: back to its root if something's
 * pushed on it, else its list to the top.
 */
function toRoot(page: PhonePage) {
  const nav = usePhoneNav.getState();
  if (page === 'you' && nav.sections.length) return nav.popSections();
  const root = document.querySelector(`[data-phone-page='${page}']`);
  if (!root) return;
  for (const el of root.querySelectorAll<HTMLElement>('*')) {
    if (el.scrollTop > 0 && el.scrollHeight > el.clientHeight) el.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

/** A tab bar's tap: the tab, or the tab already shown back to its root. */
function choose(page: PhonePage) {
  const nav = usePhoneNav.getState();
  if (nav.page === page) toRoot(page);
  else nav.showPage(page);
}

/**
 * Files, Bookmarks, Search and You, along the bottom, as a floating capsule
 * whose highlight springs to the tab shown; hidden while the keyboard's up.
 * Where there's no native one (`NativeFooter`): the web on a phone, a narrow
 * window.
 */
function AppFooter() {
  const page = usePhoneNav((s) => s.page);
  const keyboard = useKeyboard((s) => s.docked);
  const { username, attention } = useAccountActions();
  const edge = useScrollEdge('bottom');

  if (keyboard) return null;

  // Icons alone, named for screen readers; each a full-height target.
  const item = (id: PhonePage, label: string, icon: React.ReactNode) => (
    <button
      key={id}
      type='button'
      aria-label={label}
      aria-current={page === id ? 'page' : undefined}
      onClick={() => choose(id)}
      className={cn(
        'relative flex min-h-11 flex-1 items-center justify-center text-muted-foreground',
        page === id && 'text-foreground',
      )}
    >
      {icon}
    </button>
  );
  const index = Math.max(0, [...PAGES.map((p) => p.id), 'you'].indexOf(page));

  return (
    <nav ref={edge} className='phone-tab-bar shrink-0 px-5 pt-1.5 pb-[max(env(safe-area-inset-bottom),0.5rem)]'>
      <div className='phone-tab-capsule relative flex rounded-full p-1'>
        <span
          aria-hidden
          className='phone-tab-indicator absolute inset-y-1 left-1 w-[calc((100%-0.5rem)/4)] rounded-full'
          style={{ transform: `translateX(${index * 100}%)` }}
        />
        {PAGES.map(({ id, label, icon: Icon }) =>
          item(
            id,
            label,
            // The tab shown is drawn heavier, Bookmarks filled, as UIKit fills them.
            <Icon
              className={cn('size-6', page === id && id === 'bookmarks' && 'fill-current')}
              strokeWidth={page === id ? 2.4 : 1.8}
            />,
          ),
        )}
        {item(
          'you',
          'You',
          <UserAvatar
            username={username}
            attention={attention}
            className={cn('size-6', page === 'you' && 'ring-2 ring-foreground')}
          />,
        )}
      </div>
    </nav>
  );
}

/** SF Symbols for the native bar's tabs, plain and selected. */
const SYMBOLS: Record<Exclude<PhonePage, 'you'>, [string, string]> = {
  files: ['folder', 'folder.fill'],
  bookmarks: ['bookmark', 'bookmark.fill'],
  search: ['magnifyingglass', 'magnifyingglass'],
};

/**
 * The iPhone's tab bar is UIKit's (`TabBar.swift`), floating over the
 * webview; this tells it what to show and keeps its room. It steps aside
 * for a pushed note, the keyboard, and any sheet or menu, which the web
 * draws under it.
 */
function NativeFooter() {
  const page = usePhoneNav((s) => s.page);
  const noteOpen = usePhoneNav((s) => s.noteOpen);
  const keyboard = useKeyboard((s) => s.docked);
  const { username, attention } = useAccountActions();
  const overlay = useWebOverlay();
  const [inset, setInset] = useState<number | null>(null);

  useEffect(() => {
    const listening = nativeTabBar.listen((event) => {
      if (event.type === 'inset') setInset(event.inset);
      else choose(event.id as PhonePage);
    });
    return () => {
      void listening.then((listener) => listener.unregister());
      void nativeTabBar.set([], null, true);
    };
  }, []);

  const items = useMemo<TabBarItem[]>(
    () => [
      ...PAGES.map(({ id, label }) => {
        const [symbol, selectedSymbol] = SYMBOLS[id as keyof typeof SYMBOLS];
        return { id, label, symbol, selectedSymbol };
      }),
      username
        ? { id: 'you', label: 'You', initials: initials(username), badge: attention }
        : { id: 'you', label: 'You', symbol: 'person.crop.circle', selectedSymbol: 'person.crop.circle.fill', badge: attention },
    ],
    [username, attention],
  );
  const hidden = noteOpen || keyboard || overlay;
  useEffect(() => void nativeTabBar.set(items, page, hidden), [items, page, hidden]);

  if (keyboard) return null;
  // Until the bar says, UIKit's usual height over the home indicator.
  return (
    <div
      aria-hidden
      className='shrink-0'
      style={{ height: inset ?? 'calc(49px + env(safe-area-inset-bottom))' }}
    />
  );
}

/** Whether a sheet, dialog or menu is open over the app (`webOverlayOpen`). */
function useWebOverlay() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const check = () => setOpen(webOverlayOpen());
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true });
    check();
    return () => observer.disconnect();
  }, []);
  return open;
}
