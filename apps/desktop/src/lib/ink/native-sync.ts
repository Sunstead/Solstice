import { nativeInk, type InkEvent } from '@/lib/backend/native';
import { getSetting, subscribeToSetting } from '@/lib/settings/store';
import { inkDispatch, phoneInk, useInkTools, useInkUi } from '@/lib/stores/ink-tools';
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
    if (!phoneInk && (!before || state.fingerDraws !== before.fingerDraws)) void nativeInk.setFingerDraws(state.fingerDraws);
  };
  // On an iPhone the tools showing is the switch (`phoneInk`).
  const fingerOnPhone = (on: boolean) => {
    if (phoneInk) void nativeInk.setFingerDraws(on);
  };
  fingerOnPhone(getSetting('ink.ribbon'));
  const stopRibbon = subscribeToSetting('ink.ribbon', fingerOnPhone);
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
    stopRibbon();
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
      // The position is known only while the Pencil hovers; keep the last one
      // seen so a squeeze that reports none opens where the menu was, not in
      // the middle of the screen.
      const known = event.x != null && event.y != null ? { x: event.x, y: event.y } : null;
      const at = known ?? useInkUi.getState().paletteAt;
      const x = at?.x ?? window.innerWidth / 2;
      const y = at?.y ?? window.innerHeight / 2;
      useInkUi.setState({
        palette: { x, y, azimuth: event.azimuth, page: result.page },
        ...(known ? { paletteAt: known } : {}),
      });
      break;
    }
  }
}
