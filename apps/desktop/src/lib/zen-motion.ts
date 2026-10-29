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

type Box = { left: number; top: number; width: number; height: number };

/**
 * A pane as `bandPieces` sees it: its box, and where a native view in it
 * starts (its top-left). Held at its larger size (`easeHold`), the view
 * covers everything right of and below that, its own ground and all.
 */
export type BandPane = Box & { native?: Point };

/**
 * What the panes uncover while the editor area is put back by `offset`: the
 * strip each outermost pane leaves on the side it came from, corners
 * included where it's outermost both ways. Where a native view already
 * covers it (right of a pane and below), none: the paper shows there.
 */
export function bandPieces(panes: BandPane[], offset: { x: number; y: number }): Box[] {
  const { x, y } = offset;
  if (!panes.length || (!x && !y)) return [];
  const near = (a: number, b: number) => Math.abs(a - b) < 1;
  const left = Math.min(...panes.map((p) => p.left));
  const top = Math.min(...panes.map((p) => p.top));
  const right = Math.max(...panes.map((p) => p.left + p.width));
  const bottom = Math.max(...panes.map((p) => p.top + p.height));
  const w = Math.abs(x);
  const h = Math.abs(y);
  const pieces: Box[] = [];
  for (const p of panes) {
    // Left of it (x > 0) or right of it (x < 0); above (y > 0) or below.
    const sideX = x > 0 ? near(p.left, left) : x < 0 && near(p.left + p.width, right);
    const sideY = y > 0 ? near(p.top, top) : y < 0 && near(p.top + p.height, bottom);
    if (sideX) {
      // Right of a native view, only the rows above it (the header).
      const height = x < 0 && p.native ? p.native.top - p.top : p.height + (sideY ? h : 0);
      const at = sideY && y > 0 ? p.top - h : p.top;
      if (height > 0) pieces.push({ left: x > 0 ? p.left - w : p.left + p.width, top: at, width: w, height });
    }
    if (sideY) {
      // Below one, only the columns left of it.
      const width = y < 0 && p.native ? p.native.left - p.left : p.width;
      if (width > 0) pieces.push({ left: p.left, top: y > 0 ? p.top - h : p.top + p.height, width, height: h });
    }
  }
  return pieces;
}

/**
 * Paints `bandPieces` the notes' colour in a layer of the editor area, so
 * they ride with it, until the returned function: entering, the strip the
 * tab row left above the header; leaving, the room a narrower pane will
 * fill. Without it the window shows there, and under a native view that's
 * the host, the sidebar's colour under Islands. Laid out anew as flexlayout
 * moves the panes, a frame late.
 */
function paintBand(inset: HTMLElement, offset: { x: number; y: number }): () => void {
  const layer = document.createElement('div');
  layer.setAttribute('aria-hidden', '');
  layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:20';
  inset.append(layer);
  const place = () => {
    const box = inset.getBoundingClientRect();
    const panes = [...inset.querySelectorAll<HTMLElement>('.flexlayout__tab')].flatMap((el) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return [];
      const view = el.querySelector('[data-native-surface]')?.getBoundingClientRect();
      const native = view?.width ? { left: view.left - box.left, top: view.top - box.top } : undefined;
      return [{ left: r.left - box.left, top: r.top - box.top, width: r.width, height: r.height, native }];
    });
    layer.replaceChildren(
      ...bandPieces(panes, offset).map((p) => {
        const piece = document.createElement('div');
        piece.style.cssText = `position:absolute;background:var(--background);left:${p.left}px;top:${p.top}px;width:${p.width}px;height:${p.height}px`;
        return piece;
      }),
    );
  };
  place();
  const watch = new ResizeObserver(place);
  watch.observe(inset);
  for (const el of inset.querySelectorAll('.flexlayout__tab')) watch.observe(el);
  return () => {
    watch.disconnect();
    layer.remove();
  };
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
    // A part hidden by an earlier pass may not move in this one.
    hidden.forEach((el) => (el.style.visibility = ''));
    hidden.clear();
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
  return (): Promise<void> => {
    watch.disconnect();
    held.forEach((a) => a.play());
    return Promise.all(held.map((a) => a.finished.catch(() => undefined))).then(() => {
      hidden.forEach((el) => (el.style.visibility = ''));
      // Styled now, while `data-zen-moving` still turns transitions off: a
      // button's `transition-all` takes `visibility` too, and WebKit paints
      // the first frame of hidden-to-visible hidden, so the parts blinked.
      void inset.offsetHeight;
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
  const moved = animations[0].finished.catch(() => undefined);
  if (!reduced) void moved.then(paintBand(inset, { x, y }));
  const playMarks = marks && !reduced ? flipMarks(inset, marks, timing) : null;
  // Over once the header's parts are back too (`flipMarks`).
  let landed: Promise<unknown> = moved;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      animations.forEach((a) => a.play());
      if (playMarks) landed = Promise.all([moved, playMarks()]);
      onPlay?.();
    }),
  );
  return moved.then(() => landed);
}
