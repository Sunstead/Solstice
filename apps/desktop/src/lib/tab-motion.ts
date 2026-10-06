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

const entering = new Set<string>();

/** Call before adding a tab the user asked for, so it grows in. */
export function markEntering(id: string) {
  settle();
  if (motionEnabled()) entering.add(id);
}

/**
 * Grows a newly mounted tab button from nothing, if it was marked. Runs in
 * a layout effect, so nothing paints in between.
 */
export function playEnter(id: string, button: HTMLElement) {
  if (!entering.delete(id)) return;
  // After the commit, not in it: flexlayout measures the strip for overflow
  // in its own layout effect, which runs after ours, and must see the tab at
  // full size or it misjudges the overflow. A microtask still runs before
  // the frame paints.
  queueMicrotask(() => {
    if (!button.isConnected) return;
    // The strip's tab container keeps its final width while the tab grows.
    // flexlayout's overflow check (on every strip resize) then never sees
    // the tab small and undocks the + button mid-animation, and in a
    // squeezed strip the other tabs shrink smoothly from where they were.
    const container = button.parentElement;
    const token = Symbol();
    if (container) {
      const room = container.parentElement?.clientWidth ?? Infinity;
      container.style.minWidth = px(Math.min(container.getBoundingClientRect().width, room));
      holds.set(container, token);
    }
    // One keyframe, at the start: the end is whatever the stylesheet says,
    // so the tab grows until the strip's flex share stops it and never
    // overshoots a width measured too early.
    const animation = button.animate(
      [
        {
          minWidth: '0px',
          maxWidth: '0px',
          paddingLeft: '0px',
          paddingRight: '0px',
          marginLeft: '0px',
          marginRight: '0px',
          opacity: 0,
          offset: 0,
        },
      ],
      { duration: OPEN_MS, easing: EASE },
    );
    const release = () => {
      if (container && holds.get(container) === token) {
        container.style.minWidth = '';
        holds.delete(container);
      }
    };
    animation.finished.then(release, release);
  });
}

/** The latest open animation holding each tab container's width. */
const holds = new WeakMap<HTMLElement, symbol>();

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
        marginRight: '0px',
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

  const widths = buttons.map((b) => b.getBoundingClientRect().width);
  buttons.forEach((b, i) => {
    b.style.minWidth = px(widths[i]);
    b.style.maxWidth = px(widths[i]);
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
    b.style.minWidth = '';
    b.style.maxWidth = '';
    delete b.dataset.tabFrozen;
  }
  if (!motionEnabled()) return;

  // From the held width to whatever the stylesheet gives now (one keyframe),
  // so each tab ends exactly where the strip puts it.
  buttons.forEach((b, i) => {
    b.animate([{ minWidth: px(before[i]), maxWidth: px(before[i]), offset: 0 }], {
      duration: SETTLE_MS,
      easing: EASE,
    });
  });
}
