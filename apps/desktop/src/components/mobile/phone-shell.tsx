import { useEffect, useReducer, useRef } from 'react';
import { Files, Search } from 'lucide-react';

import { useAccountActions } from '@/hooks/use-account-actions';
import { BlankTab } from '@/components/blank-tab';
import { TabContent } from '@/components/tab-content';
import { UserAvatar } from '@/components/user-avatar';
import { useViewport } from '@/hooks/use-visual-viewport';
import { useLayout } from '@/hooks/use-layout';
import { useLayoutSession } from '@/hooks/use-layout-session';
import { useWorkspace } from '@/hooks/use-workspace';
import { registerCommand, unregisterCommand } from '@/lib/commands';
import { useEntryInput } from '@/lib/stores/entry-input';
import { usePhoneNav, type PhonePage } from '@/lib/stores/phone-nav';
import { useRevealTarget } from '@/lib/stores/reveal-target';
import { useSettingsDialog } from '@/lib/stores/settings-dialog';
import { cn } from '@/lib/utils';
import { FilesPage } from './files-page';
import { NoteHeader } from './note-pane';
import { tabPath } from './phone-history';
import { HEADER_HEIGHT } from './phone-parts';
import { PushPane } from './push-pane';
import { SearchPage } from './search-page';
import { shownTab } from './tabs';
import { YouPage } from './you-page';

/**
 * The app on a phone (and in a desktop window that narrow), the way Discord
 * does it: the files are home, full screen, with Files, Search and You in a
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
    };
    model.addChangeListener(listener);
    return () => model.removeChangeListener(listener);
  }, [model, handleModelChange]);

  useEffect(() => {
    useLayout.getState().setOpenInPlace(true);
    return () => useLayout.getState().setOpenInPlace(false);
  }, []);

  const workspace = useWorkspace((s) => s.path);
  useEffect(() => usePhoneNav.getState().reset(), [workspace]);

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

  // Naming something new, or finding one in the tree, happens on the files.
  const naming = useEntryInput((s) => s.operation !== null);
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
          {page === 'search' && <SearchPage />}
          {page === 'you' && <YouPage />}
        </div>
        <AppFooter />
      </div>
      {model && (
        <PushPane open={noteOpen} onClose={goHome} behind={home} keepMounted edgeTop={HEADER_HEIGHT}>
          <NoteHeader model={model} shown={shown} />
          <div className='relative min-h-0 flex-1 bg-background'>
            {shown ? <TabContent key={shownId} node={shown} /> : <BlankTab tabId='' />}
          </div>
        </PushPane>
      )}
    </div>
  );
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
  { id: 'search', label: 'Search', icon: Search },
];

/** Files, Search and You, along the bottom; hidden while the keyboard's up. */
function AppFooter() {
  const page = usePhoneNav((s) => s.page);
  const showPage = usePhoneNav((s) => s.showPage);
  const keyboard = useViewport((s) => s.keyboard);
  const { username, attention } = useAccountActions();

  if (keyboard) return null;

  const item = (id: PhonePage, label: string, icon: React.ReactNode) => (
    <button
      key={id}
      type='button'
      aria-current={page === id ? 'page' : undefined}
      onClick={() => showPage(id)}
      className={cn(
        'flex flex-1 flex-col items-center justify-center gap-0.5 pt-1.5 text-[11px] font-medium text-muted-foreground',
        page === id && 'text-foreground',
      )}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <nav className='flex shrink-0 border-t bg-sidebar pb-[max(env(safe-area-inset-bottom),0.375rem)]'>
      {PAGES.map(({ id, label, icon: Icon }) => item(id, label, <Icon className='size-6' />))}
      {item(
        'you',
        'You',
        <UserAvatar
          username={username}
          attention={attention}
          className={cn('size-6', page === 'you' && 'ring-2 ring-foreground')}
        />,
      )}
    </nav>
  );
}
