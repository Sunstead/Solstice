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
};

/**
 * Plays the switch; resolves once it has (at once when there's nothing to
 * move). The first frame is held until the main thread has painted twice:
 * the switch's own work (flexlayout maximizing, the editor laying out at its
 * new size, a native view following) can take longer than the whole motion on
 * an iPad, and an animation whose clock ran through it was over unseen.
 */
export function playZen({ inset, column, entering, before }: ZenParts): Promise<unknown> {
  const { x, y } = paneOffset(before, paneOrigin(inset));
  if (x === 0 && y === 0) return Promise.resolve();

  const timing = pushTiming();
  // Reduce Motion: a crossfade in place of the slide, as iOS does.
  const animations = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
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
  requestAnimationFrame(() => requestAnimationFrame(() => animations.forEach((a) => a.play())));
  return animations[0].finished.catch(() => undefined);
}
