import { useCallback, useLayoutEffect, useRef, useState } from 'react';

import { boundsOf } from '@/lib/canvas/doc';
import { useCanvasStore, useCanvasStoreApi } from '@/lib/canvas/use-canvas-store';
import { useResolvedColors } from '@/lib/canvas/use-resolved-color';
import { fitTo, toScreen, visibleRect } from '@/lib/canvas/viewport';

/**
 * A whole board at a glance, and a way to jump around it. Drawn on a canvas
 * rather than scaled-down DOM: at this size a card is a few pixels of coloured
 * rectangle, and the real thing would lay every card out twice.
 */

const WIDTH = 180;
const HEIGHT = 120;
const PADDING = 6;

/** Preset colours by index, plus the neutral a card with no colour gets. */
const COLOUR_PROPERTIES = [
  '--canvas-color-1',
  '--canvas-color-2',
  '--canvas-color-3',
  '--canvas-color-4',
  '--canvas-color-5',
  '--canvas-color-6',
  '--muted-foreground',
  '--ring',
];

export function CanvasMinimap() {
  const store = useCanvasStoreApi();
  const doc = useCanvasStore((state) => state.doc);
  const view = useCanvasStore((state) => state.view);
  const pane = useCanvasStore((state) => state.pane);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const colors = useResolvedColors(canvasRef, COLOUR_PROPERTIES);
  const [, forceDraw] = useState(0);

  // Shared by the draw and the click handler, so what you point at is what
  // you get.
  const bounds = boundsOf(doc.nodes);
  const mini = fitTo(bounds, { width: WIDTH, height: HEIGHT }, PADDING);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== WIDTH * dpr) canvas.width = WIDTH * dpr;
    if (canvas.height !== HEIGHT * dpr) canvas.height = HEIGHT * dpr;

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, WIDTH, HEIGHT);

    const palette = colors.current;
    const neutral = palette['--muted-foreground'] || '#888';

    for (const node of doc.nodes) {
      const origin = toScreen(mini, node);
      const width = Math.max(node.width * mini.scale, 1.5);
      const height = Math.max(node.height * mini.scale, 1.5);

      const colour =
        (node.color && palette[`--canvas-color-${node.color}`]) ||
        (node.color?.startsWith('#') ? node.color : null) ||
        neutral;

      // Groups as an outline, cards solid: the board's own distinction, at
      // the only fidelity this size allows.
      if (node.type === 'group') {
        context.strokeStyle = colour;
        context.globalAlpha = 0.5;
        context.lineWidth = 1;
        context.strokeRect(origin.x, origin.y, width, height);
      } else {
        context.fillStyle = colour;
        context.globalAlpha = 0.75;
        context.fillRect(origin.x, origin.y, width, height);
      }
    }

    // What is currently on screen.
    context.globalAlpha = 1;
    if (pane.width && pane.height) {
      const seen = visibleRect(view, pane);
      const origin = toScreen(mini, seen);

      context.strokeStyle = palette['--ring'] || '#fff';
      context.lineWidth = 1;
      context.strokeRect(
        origin.x,
        origin.y,
        seen.width * mini.scale,
        seen.height * mini.scale,
      );
    }
  }, [doc, view, pane, mini, colors]);

  /** Centres the board on the point clicked. */
  const jumpTo = useCallback(
    (event: React.MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const box = canvas.getBoundingClientRect();
      const target = {
        x: (event.clientX - box.left - mini.offset.x) / mini.scale,
        y: (event.clientY - box.top - mini.offset.y) / mini.scale,
      };

      const state = store.getState();
      state.setView({
        ...state.view,
        offset: {
          x: state.pane.width / 2 - target.x * state.view.scale,
          y: state.pane.height / 2 - target.y * state.view.scale,
        },
      });
    },
    [store, mini],
  );

  // `useResolvedColors` fills its cache in an effect, which runs after the
  // first draw; one extra pass picks up the palette rather than leaving a grey
  // minimap until something else changes.
  useLayoutEffect(() => {
    const id = requestAnimationFrame(() => forceDraw((n) => n + 1));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      onPointerDown={(event) => {
        // The board's own handler must not see this as a background press.
        event.stopPropagation();
        jumpTo(event);
      }}
      className='solstice-canvas-minimap'
      style={{ width: WIDTH, height: HEIGHT }}
      aria-label='Canvas minimap'
    />
  );
}
