import { nativeInk, type InkEvent } from '@/lib/backend/native';
import { inkDispatch, useInkTools, useInkUi } from '@/lib/stores/ink-tools';
import { pencilAction, selectedSlot, toNative } from './toolbox';

/**
 * Keeps the native side's tools on the web's (`useInkTools`), and answers
 * what it reports: the Pencil's double tap and squeeze, undo, and Apple's
 * colour picker. Runs while any surface is up (`retainHost`).
 */
export function followInkTools(): () => void {
  const push = (state = useInkTools.getState(), before?: typeof state) => {
    const slot = selectedSlot(state);
    if (!before || slot !== selectedSlot(before)) void nativeInk.setTool(toNative(slot));
    if (!before || state.ruler !== before.ruler) void nativeInk.setRuler(state.ruler);
    if (!before || state.fingerDraws !== before.fingerDraws) void nativeInk.setFingerDraws(state.fingerDraws);
  };
  // Once what's on disk is in: the native side has its own copy till then.
  const pushWhenHydrated = () => push();
  const stopHydrate = useInkTools.persist.hasHydrated()
    ? (pushWhenHydrated(), () => {})
    : useInkTools.persist.onFinishHydration(pushWhenHydrated);
  const unsubscribe = useInkTools.subscribe((state, before) => push(state, before));
  const listening = nativeInk.listen(onInkEvent);
  void nativeInk.undoState();
  return () => {
    stopHydrate();
    unsubscribe();
    void listening.then((listener) => listener.unregister());
    useInkUi.setState({ palette: null });
  };
}

export function onInkEvent(event: InkEvent) {
  switch (event.type) {
    case 'undo':
      useInkUi.setState({ canUndo: event.canUndo, canRedo: event.canRedo });
      break;
    case 'color':
      inkDispatch({ type: 'setColor', color: event.color, recent: event.final });
      inkDispatch({ type: 'setOpacity', opacity: event.opacity });
      break;
    case 'pencil': {
      const result = pencilAction(event);
      if (result.type === 'none') break;
      if (result.type !== 'palette') {
        inkDispatch(result);
        break;
      }
      // A second squeeze puts it away, as Apple's does.
      if (useInkUi.getState().palette) {
        useInkUi.setState({ palette: null });
        break;
      }
      const x = event.x ?? window.innerWidth / 2;
      const y = event.y ?? window.innerHeight / 2;
      useInkUi.setState({ palette: { x, y, azimuth: event.azimuth, page: result.page } });
      break;
    }
  }
}
