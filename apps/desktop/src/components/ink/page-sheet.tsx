import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpToLine, Trash2 } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@sunstead/ui/components/dropdown-menu';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { nativeInk } from '@/lib/backend/native';
import { identity, movePage, removePages } from '@/lib/ink/pages';
import { createSlotGesture } from '@/lib/ink/slot-gesture';
import { useInkUi } from '@/lib/stores/ink-tools';
import { cn } from '@/lib/utils';

const THUMB_WIDTH = 160;

/**
 * The PDF in front's pages, as a grid of thumbnails (marks included), opened
 * from the ink ribbon's + (`useInkUi.pages`; mounted once, at the root): tap
 * one to go there, hold one to delete it or send it to either end, or hold
 * and drag it to another place. Every change is made at once, to the file
 * too (`nativeInk.arrangePages`).
 */
export function PageSheet() {
  const open = useInkUi((s) => s.pages);
  const onOpenChange = (pages: boolean) => useInkUi.setState({ pages });
  const [count, setCount] = useState(0);
  const [current, setCurrent] = useState(0);
  /** Thumbnails by page index, as data URLs. */
  const [thumbs, setThumbs] = useState<Record<number, string>>({});
  const [menu, setMenu] = useState<{ index: number; at: DOMRect } | null>(null);
  const [busy, setBusy] = useState(false);
  const [gridEl, setGridEl] = useState<HTMLDivElement | null>(null);

  // Afresh each time it opens: pages may have been added since.
  useEffect(() => {
    if (!open) return;
    let live = true;
    void nativeInk.pages().then((pages) => {
      if (!live) return;
      setCount(pages.count);
      setCurrent(pages.current);
      setThumbs({});
    });
    return () => {
      live = false;
    };
  }, [open]);

  const arrange = async (order: number[]) => {
    if (busy) return;
    setBusy(true);
    try {
      await nativeInk.arrangePages(order);
      // Each page keeps its thumbnail in its new place.
      setThumbs((old) => Object.fromEntries(order.flatMap((from, to) => (old[from] ? [[to, old[from]]] : []))));
      setCount(order.length);
      setCurrent((c) => Math.max(0, Math.min(order.length - 1, order.indexOf(c))));
    } catch {
      // The viewer shows why (the surface's `error` event); the pages are as they were.
    } finally {
      setBusy(false);
    }
  };

  // Hold to lift: drag to another place, or keep still for the menu.
  const latest = useRef({ count, arrange });
  useEffect(() => {
    latest.current = { count, arrange };
  });
  useEffect(() => {
    if (!gridEl) return;
    return createSlotGesture(gridEl, {
      grid: true,
      move: (from, to) => void latest.current.arrange(movePage(identity(latest.current.count), from, to)),
      menu: (index, at) => setMenu({ index, at }),
    });
  }, [gridEl]);

  const order = identity(count);
  const menuIndex = menu?.index ?? 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='flex h-[min(80svh,760px)] flex-col overflow-hidden sm:max-w-3xl'>
        <DialogTitle>Pages</DialogTitle>
        <div
          ref={setGridEl}
          className={cn(
            'grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-4 overflow-y-auto p-1',
            busy && 'pointer-events-none opacity-60',
          )}
        >
          {order.map((index) => (
            <Thumbnail
              key={index}
              index={index}
              url={thumbs[index]}
              current={index === current}
              onNeed={(url) => setThumbs((t) => ({ ...t, [index]: url }))}
              onOpen={() => {
                void nativeInk.goToPage(index);
                onOpenChange(false);
              }}
            />
          ))}
        </div>

        <DropdownMenu open={menu !== null} onOpenChange={(o) => !o && setMenu(null)}>
          <DropdownMenuTrigger
            nativeButton={false}
            render={
              <span
                aria-hidden
                // Never focused: the dialog's first focus would scroll its pane to it.
                tabIndex={-1}
                className='pointer-events-none fixed'
                style={{
                  left: menu?.at.left ?? 0,
                  top: menu?.at.top ?? 0,
                  width: menu?.at.width ?? 0,
                  height: menu?.at.height ?? 0,
                }}
              />
            }
          />
          <DropdownMenuContent className='w-auto min-w-48'>
            <DropdownMenuItem disabled={menuIndex === 0} onClick={() => void arrange(movePage(order, menuIndex, 0))}>
              <ArrowUpToLine />
              Move to Start
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={menuIndex === count - 1}
              onClick={() => void arrange(movePage(order, menuIndex, count - 1))}
            >
              <ArrowDownToLine />
              Move to End
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant='destructive'
              disabled={count <= 1}
              onClick={() => void arrange(removePages(order, [menuIndex]))}
            >
              <Trash2 />
              Delete Page
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </DialogContent>
    </Dialog>
  );
}

/** One page: asks for its thumbnail once it scrolls into view. */
function Thumbnail({
  index,
  url,
  current,
  onNeed,
  onOpen,
}: {
  index: number;
  url: string | undefined;
  current: boolean;
  onNeed: (url: string) => void;
  onOpen: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const asked = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || url) return;
    const seen = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting || asked.current) return;
      asked.current = true;
      void nativeInk.thumbnail(index, THUMB_WIDTH).then((u) => u && onNeed(u));
    });
    seen.observe(el);
    return () => seen.disconnect();
  }, [index, url, onNeed]);

  return (
    <button
      ref={ref}
      type='button'
      data-slot-index={index}
      className={cn(
        'flex flex-col items-center gap-1.5 rounded-lg p-1.5 select-none [-webkit-touch-callout:none]',
        'transition-[scale,box-shadow] data-lifted:z-10 data-lifted:scale-105 data-lifted:shadow-xl',
        'data-drop-target:ring-2 data-drop-target:ring-primary',
      )}
      onClick={onOpen}
    >
      <span
        className={cn(
          'block aspect-[3/4] w-full overflow-hidden rounded-md bg-white shadow-sm ring-1 ring-foreground/10',
          current && 'ring-2 ring-primary',
        )}
      >
        {url && <img src={url} alt='' draggable={false} className='h-full w-full object-contain' />}
      </span>
      <span className={cn('text-xs', current ? 'font-medium text-foreground' : 'text-muted-foreground')}>
        {index + 1}
      </span>
    </button>
  );
}
