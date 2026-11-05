import { beginSurfaceEase, endSurfaceEase, playSurfaceEase } from '@/lib/native-surfaces';
import { paneOrigin, playZen, zenMarks, type ZenMarks, type ZenRun } from '@/lib/zen-motion';

type Ref<T> = { readonly current: T | null };

export type ZenController = {
  /** The switch was asked for, before React lays the new mode out. */
  prepare(entering: boolean): void;
  /** React has laid it out (a layout effect): the motion plays. */
  play(entering: boolean): void;
};

/**
 * Sequences Zen's switches for the shell (`AppShell`): one motion at a time.
 * A switch asked for mid-motion reads where everything is on screen, stops
 * the motion under way, and eases on from there; only the latest run's end
 * settles anything, so a native view stays held across the interruption and
 * the column is never hidden after leaving.
 */
export function createZenController(parts: {
  /** Clips the editor area; `data-zen-moving` turns transitions off. */
  frame: Ref<HTMLElement>;
  inset: Ref<HTMLElement>;
  column: Ref<HTMLElement>;
}): ZenController {
  let prepared: { before: ReturnType<typeof paneOrigin>; marks: ZenMarks; columnFrom?: string } | null = null;
  let run: ZenRun | null = null;
  let generation = 0;

  const stop = () => {
    run?.cancel();
    run = null;
  };

  return {
    prepare(entering) {
      const inset = parts.inset.current;
      const side = parts.column.current;
      // Read before cancelling: mid-motion, on screen is where the last run left it.
      prepared = inset && {
        before: paneOrigin(inset),
        marks: zenMarks(inset),
        columnFrom: side ? getComputedStyle(side).translate : undefined,
      };
      stop();
      // Out of the flow the column would shrink to its contents (the
      // sidebar's width is a placeholder's), and slide out as nothing. As
      // wide as all it draws (the explorer runs past its box), so sliding
      // it a whole width takes every bit off screen.
      if (entering && side) {
        const right = Math.max(...[...side.querySelectorAll('*')].map((el) => el.getBoundingClientRect().right));
        side.style.setProperty('--zen-column', `${Math.max(side.offsetWidth, right - side.getBoundingClientRect().left)}px`);
      }
      // Set before React commits the switch, or the sidebar's own
      // transitions (and the inset's padding) start, and lag the slide.
      parts.frame.current?.setAttribute('data-zen-moving', '');
      // A native view (PDF, drawing) eases its content with the page.
      beginSurfaceEase();
    },

    play(entering) {
      const from = prepared;
      prepared = null;
      const inset = parts.inset.current;
      const shell = parts.frame.current;
      const side = parts.column.current;
      const gen = ++generation;
      const settle = () => {
        if (gen !== generation) return;
        run = null;
        shell?.removeAttribute('data-zen-moving');
        endSurfaceEase();
        // Hidden once off screen, where a sliver of the explorer would stay.
        if (entering) side?.style.setProperty('visibility', 'hidden');
      };
      if (!from || !inset) {
        // Opened in Zen, or allowed again: nothing to slide.
        stop();
        return settle();
      }
      side?.style.removeProperty('visibility');
      run = playZen({
        inset,
        column: side,
        entering,
        before: from.before,
        columnFrom: from.columnFrom,
        onPlay: playSurfaceEase,
        marks: from.marks,
      });
      void run.finished.then(settle);
    },
  };
}
