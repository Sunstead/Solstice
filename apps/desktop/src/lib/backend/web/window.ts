/**
 * The page standing in for the desktop's window: no controls to work, but
 * focus is real (the app re-checks the vault when it comes back) and a
 * resize is a resize.
 */
type Unlisten = () => void;

function on(target: Window, type: string, handler: () => void): Promise<Unlisten> {
  target.addEventListener(type, handler);
  return Promise.resolve(() => target.removeEventListener(type, handler));
}

export const browserWindow = {
  isFullscreen: async () => document.fullscreenElement !== null,
  isMaximized: async () => false,
  minimize: async () => {},
  toggleMaximize: async () => {},
  close: async () => {},
  onResized: (handler: () => void) => on(window, 'resize', handler),
  onFocusChanged: async (handler: (event: { payload: boolean }) => void): Promise<Unlisten> => {
    const focus = () => handler({ payload: true });
    const blur = () => handler({ payload: false });
    window.addEventListener('focus', focus);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('focus', focus);
      window.removeEventListener('blur', blur);
    };
  },
};
