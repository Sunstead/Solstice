/**
 * flexlayout docks a tabset's + at the end of the bar when the tabs and it
 * overrun the strip, and moves it back beside the tabs when they no longer do.
 * Its check to undock allows 10px of slack that tabs squeezed to fill the
 * strip never leave, and it only runs when the strip resizes or another tab
 * is selected. So a tab closing left the + docked at the end of a bar with
 * room for it (on the iPad, where the + is 2px wider than the room kept for
 * it, as soon as the tabs fill the strip).
 *
 * Nothing in flexlayout asks for its check, so for one frame the tabs are
 * given room to spare and the strip a size change, which runs it. That is only
 * done where the tabs fit beside the + however the strip is sized: with them
 * still overrunning it, the check would dock the + again at once and the
 * room kept for the frame would undock it again, round and round.
 */

const STRIP = '.flexlayout__tabset_tabbar_inner';
const TABS = '.flexlayout__tabset_tabbar_inner_tab_container';
const TAB = 'flexlayout__tab_button';
const STICKY = '.flexlayout__tab_toolbar_sticky_buttons_container';

type Frame = (callback: () => void) => void;

/** Strips being nudged, so a second call in the frame doesn't undo the first's restore. */
const nudging = new WeakSet<Element>();

/** Whether the strip has its + docked: flexlayout then renders it in the toolbar instead. */
const docked = (strip: Element) => !strip.querySelector(`:scope > ${STICKY}`);

const px = (value: string) => parseFloat(value) || 0;

/**
 * The width the tabs take when nothing squeezes them: each tab's basis (12rem)
 * with its margins, the dividers between them, and the strip's padding. Tabs
 * held or collapsing are as wide as they are.
 */
export function naturalWidth(tabs: HTMLElement): number {
  const own = getComputedStyle(tabs);
  let width = px(own.paddingLeft) + px(own.paddingRight);
  for (const child of tabs.children) {
    const style = getComputedStyle(child);
    const held = child instanceof HTMLElement && (child.style.maxWidth !== '' || child.dataset.tabFrozen !== undefined);
    const unsqueezed = child.classList.contains(TAB) && !held;
    width += unsqueezed ? px(style.flexBasis) : child.getBoundingClientRect().width;
    width += px(style.marginLeft) + px(style.marginRight);
  }
  return width;
}

/**
 * Whether the tabs would sit beside the docked + even in the strip as wide as
 * it is while the + is docked: the strip is wider with it undocked, so this is
 * the least that is sure. Slack of the 10px flexlayout wants.
 */
function fitsBesidePlus(strip: HTMLElement, tabs: HTMLElement): boolean {
  const bar = strip.closest('.flexlayout__tabset_tabbar_outer');
  const plus = bar?.querySelector<HTMLElement>(':scope > .flexlayout__tab_toolbar')?.firstElementChild;
  if (!plus) return false;
  // Its container pads it by 2px.
  const room = plus.getBoundingClientRect().width + 2;
  return naturalWidth(tabs) + room + 10 <= strip.clientWidth;
}

/**
 * Has flexlayout check whether `strip`'s + belongs beside its tabs. A strip
 * that has it there, or whose tabs don't fit beside it, is left alone.
 */
export function reconsiderDock(strip: HTMLElement, frame: Frame = requestAnimationFrame) {
  const tabs = strip.querySelector<HTMLElement>(`:scope > ${TABS}`);
  if (!tabs || !docked(strip) || nudging.has(strip) || !fitsBesidePlus(strip, tabs)) return;
  nudging.add(strip);

  const was = { maxWidth: tabs.style.maxWidth, paddingRight: strip.style.paddingRight };
  tabs.style.maxWidth = 'calc(100% - 12px)';
  strip.style.paddingRight = '1px';
  // Resize observers run after a frame's callbacks and layout, so the strip
  // must still be this way when the next frame's callbacks have run.
  frame(() =>
    frame(() => {
      tabs.style.maxWidth = was.maxWidth;
      strip.style.paddingRight = was.paddingRight;
      nudging.delete(strip);
    }),
  );
}

/**
 * How long after a tab leaves its strip stops changing size: flexlayout drops
 * the hidden-tabs button (and the strip grows to take its room) 100ms after
 * it finds none hidden.
 */
const SETTLE_MS = 150;

/** Reconsiders a strip's docked + whenever one of `root`'s tabs leaves it. Returns the stop. */
export function watchStickyDock(root: Element, frame: Frame = requestAnimationFrame): () => void {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      const left = [...record.removedNodes].some((node) => node instanceof Element && node.classList.contains(TAB));
      if (!left || !(record.target instanceof Element) || !record.target.matches(TABS)) continue;
      const strip = record.target.closest<HTMLElement>(STRIP);
      if (!strip) continue;
      reconsiderDock(strip, frame);
      // The strip may still be about to get wider.
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (strip.isConnected) reconsiderDock(strip, frame);
      }, SETTLE_MS);
      timers.add(timer);
    }
  });
  observer.observe(root, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  };
}
