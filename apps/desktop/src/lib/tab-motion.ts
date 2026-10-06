import { Actions, type Model, TabNode, TabSetNode } from 'flexlayout-react';

/**
 * Browser-like tab motion, on top of flexlayout. It is purely visual: the
 * model changes straight away (a new tab is selected, a closed tab's
 * neighbour takes over), and only the tab buttons ease into place.
 *
 * - A tab opened by the user grows from nothing at the end of its strip, so
 *   nothing to its left moves. Tabs restored on load, moved by dragging, or
 *   swapped in for a blank tab never animate: only ids passed to
 *   `markEntering` do.
 * - A closed tab collapses to nothing before it leaves the model. When the
 *   strip is squeezed and the close came from the pointer, the other tabs
 *   keep their widths until the pointer leaves the strip (as in Chrome), so
 *   the next close button lands under the cursor.
 *
 * Earlier attempts animated with CSS, which replayed on every mount and
 * animated selection changes too; see CLAUDE.md, "Tab motion".
 */

/** Ids on the animations that move a strip's tabs, so a newer one can replace them. */
const OPEN = 'tab-open';
const SETTLE = 'tab-settle';

const OPEN_MS = 160;
const CLOSE_MS = 140;
const SETTLE_MS = 160;
const EASE = 'cubic-bezier(0.2, 0, 0, 1)';

export function motionEnabled(): boolean {
  if (typeof document === 'undefined') return false;
  if (document.documentElement.dataset.reduceMotion === 'true') return false;
  return !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** The button flexlayout renders for a tab (its `domId`), if it's on screen. */
function tabButton(id: string): HTMLElement | null {
  const button = document.getElementById('flexlayout-tabbutton-' + id.replace(/\s/g, '_'));
  return typeof button?.animate === 'function' ? button : null;
}

const px = (n: number) => `${n}px`;

// -- Opening --

/** Tabs the user just opened, by their button's DOM id, not yet animated. */
const entering = new Set<string>();

const buttonId = (id: string) => 'flexlayout-tabbutton-' + id.replace(/\s/g, '_');

/**
 * The room each tab and strip last took on screen (margins included),
 * refreshed every time a tab is about to open. Never cleared: two quick opens
 * can land in one render, and the second snapshot must not forget a tab the
 * first one saw.
 */
const before = new WeakMap<Element, number>();

function roomOf(el: Element): number {
  const style = getComputedStyle(el);
  return el.getBoundingClientRect().width + parseFloat(style.marginLeft) + parseFloat(style.marginRight);
}

/** The opening and settling animations on an element (not a closing tab's). */
function moving(el: Element): Animation[] {
  return (el.getAnimations?.() ?? []).filter((a) => a.id === OPEN || a.id === SETTLE);
}

/** Call before adding a tab the user asked for, so it grows in. */
export function markEntering(id: string) {
  settle();
  if (!motionEnabled()) return;
  entering.add(buttonId(id));
  // Where everything is on screen now, mid-animation or not; animateStrip
  // eases each from here. Then whatever is still easing from an earlier
  // open stops: flexlayout measures the strip for overflow as the new tab
  // lands, and must see real widths, not ones an animation is holding (it
  // would dock the + button, and the strip would jump when it undocked).
  // Nothing paints before animateStrip starts again from these widths.
  const els = document.querySelectorAll(
    '.flexlayout__tabset_tabbar_inner_tab_container, .flexlayout__tabset_tabbar_inner_tab_container > .flexlayout__tab_button',
  );
  for (const el of els) before.set(el, roomOf(el));
  for (const el of els) for (const animation of moving(el)) animation.cancel();
}

/**
 * Called as a tab button mounts (a layout effect, so nothing paints in
 * between). If it was just opened, its strip is animated: see `animateStrip`.
 */
export function playEnter(_id: string, button: HTMLElement) {
  if (!entering.has(button.id)) return;
  // After the commit, not in it: flexlayout measures the strip for overflow
  // in its own layout effect, which runs after ours, and must see the tab at
  // full size. A microtask still runs before the frame paints.
  queueMicrotask(() => {
    if (button.isConnected && button.parentElement) animateStrip(button.parentElement);
  });
}

/**
 * Grows the strip's newly opened tabs from nothing and eases everything else
 * in it from where it was to where it now is. Every width is set
 * explicitly, from before to after, on one curve: tabs already there move
 * one way only (not at all with room to spare, shrinking together in a
 * squeezed strip), never drifting on how flexbox happens to share the space
 * mid-way.
 */
function animateStrip(container: HTMLElement) {
  const tabs = buttonsIn(container);
  const fresh = new Set(tabs.filter((b) => entering.has(b.id)));
  // Already done by another tab's call in the same render.
  if (fresh.size === 0) return;
  for (const b of fresh) entering.delete(b.id);

  // Anything that started easing since (another tab's open in this render)
  // is dropped too, so the measuring below sees real widths.
  for (const el of [container, ...tabs]) for (const animation of moving(el)) animation.cancel();

  // All measured before any animation starts: a running one changes what the
  // next measurement sees.
  const after = tabs.map((b) => {
    const style = getComputedStyle(b);
    return {
      width: b.getBoundingClientRect().width,
      marginLeft: parseFloat(style.marginLeft),
      marginRight: parseFloat(style.marginRight),
      paddingLeft: style.paddingLeft,
      paddingRight: style.paddingRight,
    };
  });
  const strip = { from: before.get(container), to: container.getBoundingClientRect().width };
  const timing = { id: OPEN, duration: OPEN_MS, easing: EASE };
  const size = (w: number) => ({ minWidth: px(w), maxWidth: px(w) });

  // The container too, so flexlayout's overflow check (on every strip resize)
  // sees the strip's real size throughout.
  if (strip.from !== undefined) container.animate([size(strip.from), size(strip.to)], timing);

  tabs.forEach((b, i) => {
    const end = after[i];
    if (fresh.has(b)) {
      b.animate(
        [
          {
            ...size(0),
            paddingLeft: '0px',
            paddingRight: '0px',
            // A new tab brings a 1px divider with it; starting 1px under
            // nothing means the strip doesn't step when it lands.
            marginLeft: '-1px',
            marginRight: '0px',
            opacity: 0,
          },
          {
            ...size(end.width),
            paddingLeft: end.paddingLeft,
            paddingRight: end.paddingRight,
            marginLeft: px(end.marginLeft),
            marginRight: px(end.marginRight),
            opacity: 1,
          },
        ],
        timing,
      );
      return;
    }
    const room = before.get(b);
    if (room === undefined) return;
    // The room it took, in its margins now: a tab that just stopped being
    // selected has gained margins, not width. Held even when that's no
    // change, or the strip easing around it would squeeze it.
    const from = room - end.marginLeft - end.marginRight;
    b.animate([size(from), size(end.width)], timing);
  });
}

// -- Closing --

const closing = new Set<string>();

/** Whether a tab is on its way out (still in the model, but leaving). */
export function isClosing(id: string): boolean {
  return closing.has(id);
}

/**
 * Closes a tab the user closed: its neighbour is selected now, its button
 * collapses, and then it leaves the model. `pointer` says the close came
 * from the mouse, which holds the other tabs' widths (see `freeze`).
 * Anything else that closes tabs (a deleted file, a closed folder) calls
 * `Actions.deleteTab` directly and skips all of this.
 */
export function closeTab(model: Model, id: string, { pointer }: { pointer: boolean }) {
  if (closing.has(id)) return;
  const node = model.getNodeById(id);
  if (!(node instanceof TabNode)) return;

  const button = motionEnabled() ? tabButton(id) : null;
  if (!button) {
    model.doAction(Actions.deleteTab(id));
    return;
  }

  if (pointer && button.parentElement) freeze(button.parentElement);
  else settle();

  const width = button.getBoundingClientRect().width;
  const style = getComputedStyle(button);
  closing.add(id);

  // Hand the selection on as the delete would (the next tab, or the one
  // before at the end), so its content shows at once.
  const parent = node.getParent();
  if (parent instanceof TabSetNode && parent.getSelectedNode() === node) {
    const staying = parent.getChildren().filter((c) => c === node || !closing.has(c.getId()));
    const at = staying.indexOf(node);
    const next = staying[at + 1] ?? staying[at - 1];
    if (next) model.doAction(Actions.selectTab(next.getId()));
  }

  button.style.pointerEvents = 'none';
  const animation = button.animate(
    [
      {
        minWidth: px(width),
        maxWidth: px(width),
        paddingLeft: style.paddingLeft,
        paddingRight: style.paddingRight,
        marginLeft: style.marginLeft,
        marginRight: style.marginRight,
        opacity: 1,
      },
      { opacity: 0, offset: 0.6 },
      {
        minWidth: '0px',
        maxWidth: '0px',
        paddingLeft: '0px',
        paddingRight: '0px',
        marginLeft: '0px',
        // Its 1px divider goes when it leaves the model; ending 1px short
        // means nothing steps when it does.
        marginRight: '-1px',
        opacity: 0,
      },
    ],
    { duration: CLOSE_MS, easing: EASE, fill: 'forwards' },
  );

  const remove = () => {
    closing.delete(id);
    if (model.getNodeById(id)) model.doAction(Actions.deleteTab(id));
  };
  animation.finished.then(remove, remove);
}

// -- Holding widths while closing with the pointer --

let frozen: { strip: HTMLElement; release: () => void } | null = null;

function buttonsIn(strip: HTMLElement): HTMLElement[] {
  return [...strip.children].filter(
    (el): el is HTMLElement => el instanceof HTMLElement && el.classList.contains('flexlayout__tab_button'),
  );
}

/**
 * Pins every tab in a squeezed strip at its current width. Tabs to the
 * right of a closing one still slide into its place, but none grow, so the
 * next close button lands where the last one was. A strip whose tabs are at
 * full width has nothing to hold.
 */
function freeze(strip: HTMLElement) {
  if (frozen?.strip === strip) return;
  settle();

  const buttons = buttonsIn(strip);
  const squeezed = buttons.some(
    (b) => b.getBoundingClientRect().width < parseFloat(getComputedStyle(b).maxWidth) - 0.5,
  );
  if (!squeezed) return;

  // The room each tab takes, margins included: held that way (see
  // flexlayout.css), a tab keeps its place when it becomes selected or stops
  // being, as the closed tab's neighbour does.
  const room = buttons.map(roomOf);
  buttons.forEach((b, i) => {
    b.style.setProperty('--tab-held', px(room[i]));
    b.dataset.tabFrozen = '';
  });

  const bar = strip.closest<HTMLElement>('.flexlayout__tabset_tabbar_outer') ?? strip;
  const onLeave = () => settle();
  bar.addEventListener('pointerleave', onLeave);
  window.addEventListener('resize', onLeave);
  frozen = {
    strip,
    release: () => {
      bar.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('resize', onLeave);
    },
  };
}

/** Lets held tabs ease back to the widths the strip gives them. */
export function settle() {
  if (!frozen) return;
  const { strip, release } = frozen;
  frozen = null;
  release();

  const buttons = buttonsIn(strip).filter((b) => b.dataset.tabFrozen !== undefined);
  const before = buttons.map((b) => b.getBoundingClientRect().width);
  for (const b of buttons) {
    b.style.removeProperty('--tab-held');
    delete b.dataset.tabFrozen;
  }
  if (!motionEnabled()) return;

  // From the held width to whatever the stylesheet gives now (one keyframe),
  // so each tab ends exactly where the strip puts it.
  buttons.forEach((b, i) => {
    b.animate([{ minWidth: px(before[i]), maxWidth: px(before[i]), offset: 0 }], {
      id: SETTLE,
      duration: SETTLE_MS,
      easing: EASE,
    });
  });
}
