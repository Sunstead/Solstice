import { pushSpring } from '@/lib/push-spring';

/**
 * Zen mode's motion. The layout changes at once (`data-zen`, the sidebar
 * column taken out of the flow) and this only eases what's on screen after
 * it, with transforms: the editor area from where its pane was, the column
 * off the edge or back. Animating the layout itself relaid out flexlayout and
 * the editor every frame, and left flexlayout measuring a strip mid-change.
 */

/** The push spring (`pushSpring`), as a page pushed over another moves. */
function pushTiming(): KeyframeAnimationOptions {
  const { ms, easing } = pushSpring();
  return { duration: ms, easing };
}

type Point = { left: number; top: number };

/**
 * Where the panes start: the editor area's content box, under the tab strip.
 * Read from those rather than from a pane, which flexlayout only moves a
 * frame after the switch.
 */
export function paneOrigin(inset: HTMLElement): Point {
  const box = inset.getBoundingClientRect();
  const style = getComputedStyle(inset);
  const strips = [...inset.querySelectorAll<HTMLElement>('.flexlayout__tabset_tabbar_outer')];
  const strip = Math.max(0, ...strips.map((el) => el.offsetHeight));
  return {
    left: box.left + parseFloat(style.paddingLeft),
    top: box.top + parseFloat(style.paddingTop) + strip,
  };
}

/** Where each part marked `data-zen-flip` in the editor area was: its anchor's x, and its top. */
export type ZenMarks = Map<HTMLElement, { x: number; top: number }>;

export function zenMarks(inset: HTMLElement): ZenMarks {
  return new Map(
    [...inset.querySelectorAll<HTMLElement>('[data-zen-flip]')].map((el) => {
      const r = el.getBoundingClientRect();
      return [el, { x: anchorX(el, r), top: r.top }];
    }),
  );
}

/**
 * The x a part is kept by (`data-zen-flip`): its left edge, right edge or
 * middle, so a header's actions stay with its right edge and its title with
 * the middle; or, for a note's column, where its text starts (the column is
 * centred only once the pane is wider than the line length).
 */
function anchorX(el: HTMLElement, r: DOMRectReadOnly): number {
  const anchor = el.dataset.zenFlip;
  if (anchor === 'text') {
    const text = el.querySelector<HTMLElement>('.ProseMirror, .cm-content');
    return text ? text.getBoundingClientRect().left + parseFloat(getComputedStyle(text).paddingLeft) : r.left;
  }
  return anchor === 'end' ? r.right : anchor === 'center' ? r.left + r.width / 2 : r.left;
}

/** How far the pane moved, as the translate that puts it back where it was. */
export function paneOffset(before: Point, after: Point): { x: number; y: number } {
  return { x: before.left - after.left, y: before.top - after.top };
}

type ZenParts = {
  /** The editor area, eased from where its pane was. */
  inset: HTMLElement;
  /** The title bar and sidebar column, slid off the left edge or back. */
  column: HTMLElement | null;
  entering: boolean;
  /** `paneOrigin` before the switch. */
  before: Point;
  /** Called as the motion starts, after its held first frame. */
  onPlay?: () => void;
  /** `zenMarks` before the switch: each part eased from where it was. */
  marks?: ZenMarks;
};

/**
 * Eases each marked part from where it was to where it lands, on top of the
 * editor area's own motion, held at its start until `play`. A part that
 * moves within its pane (`data-zen-flip='text'`) is moved itself; the
 * header's parts move as copies in a layer over the editor area, the
 * originals hidden until they land, since on the way they pass outside the
 * pane, which clips. Laid out anew (flexlayout moves its panes a frame
 * late), each is measured again before that frame paints, so no part jumps.
 */
function flipMarks(inset: HTMLElement, marks: ZenMarks, timing: KeyframeAnimationOptions) {
  const layer = document.createElement('div');
  layer.setAttribute('aria-hidden', '');
  layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:30';
  inset.append(layer);
  const held: Animation[] = [];
  const hidden = new Set<HTMLElement>();
  const place = () => {
    held.splice(0).forEach((a) => a.cancel());
    layer.replaceChildren();
    const box = inset.getBoundingClientRect();
    for (const [el, before] of marks) {
      if (!el.isConnected) continue;
      const now = el.getBoundingClientRect();
      const dx = before.x - anchorX(el, now);
      const dy = before.top - now.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      const keyframes = [{ translate: `${dx}px ${dy}px` }, { translate: '0 0' }];
      let moved: HTMLElement = el;
      if (el.dataset.zenFlip !== 'text') {
        moved = el.cloneNode(true) as HTMLElement;
        moved.removeAttribute('data-zen-flip');
        // The original may be hidden already (an earlier pass).
        Object.assign(moved.style, {
          visibility: 'visible',
          position: 'absolute',
          margin: '0',
          boxSizing: 'border-box',
          left: `${now.left - box.left}px`,
          top: `${now.top - box.top}px`,
          width: `${now.width}px`,
          height: `${now.height}px`,
        });
        layer.append(moved);
        el.style.visibility = 'hidden';
        hidden.add(el);
      }
      const animation = moved.animate(keyframes, timing);
      animation.pause();
      held.push(animation);
    }
  };
  place();
  const watch = new ResizeObserver(place);
  watch.observe(inset);
  for (const el of inset.querySelectorAll('.flexlayout__tab')) watch.observe(el);
  for (const el of marks.keys()) watch.observe(el);
  return () => {
    watch.disconnect();
    held.forEach((a) => a.play());
    void Promise.all(held.map((a) => a.finished.catch(() => undefined))).then(() => {
      hidden.forEach((el) => (el.style.visibility = ''));
      layer.remove();
    });
  };
}

/**
 * Plays the switch; resolves once it has (at once when there's nothing to
 * move). The first frame is held until the main thread has painted twice:
 * the switch's own work (flexlayout maximizing, the editor laying out at its
 * new size, a native view following) can take longer than the whole motion on
 * an iPad, and an animation whose clock ran through it was over unseen.
 */
export function playZen({ inset, column, entering, before, onPlay, marks }: ZenParts): Promise<unknown> {
  const { x, y } = paneOffset(before, paneOrigin(inset));
  if (x === 0 && y === 0) return Promise.resolve();

  const timing = pushTiming();
  // Reduce Motion: a crossfade in place of the slide, as iOS does.
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const animations = reduced
    ? [inset.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' })]
    : [
        inset.animate([{ transform: `translate(${x}px, ${y}px)` }, { transform: 'none' }], timing),
        // `translate`, not `transform`: it's what the column's
        // `-translate-x-full` sets in Zen, and the two would add up.
        ...(column
          ? [
              column.animate(
                entering
                  ? [{ translate: '0' }, { translate: '-100% 0' }]
                  : [{ translate: '-100% 0' }, { translate: '0' }],
                timing,
              ),
            ]
          : []),
      ];
  for (const a of animations) a.pause();
  const playMarks = marks && !reduced ? flipMarks(inset, marks, timing) : null;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      animations.forEach((a) => a.play());
      playMarks?.();
      onPlay?.();
    }),
  );
  return animations[0].finished.catch(() => undefined);
}
