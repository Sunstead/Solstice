/**
 * Dynamic Type for the phone layout: the root font size follows the user's
 * text size (Settings > Display & Brightness > Text Size), as `body` text
 * does, so every rem in the chrome scales with it. At the default size
 * (`-apple-system-body` is 17px) nothing changes.
 *
 * Only WebKit on Apple platforms knows the text styles; elsewhere, and
 * outside the phone layout, the root keeps the browser's size.
 */
export function followDynamicType() {
  if (!CSS.supports('font', '-apple-system-body')) return () => {};
  const root = document.documentElement;
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;visibility:hidden;font:-apple-system-body';
  probe.textContent = 'x';

  const apply = () => {
    document.body.append(probe);
    const size = parseFloat(getComputedStyle(probe).fontSize);
    probe.remove();
    // The largest accessibility sizes would leave a bar with room for one word.
    const scale = Math.min(Math.max(size / 17, 0.82), 1.35);
    root.style.fontSize = Number.isFinite(scale) && scale !== 1 ? `${16 * scale}px` : '';
  };

  apply();
  // The size is changed in Settings, so it can only have changed on coming back.
  const onVisible = () => {
    if (document.visibilityState === 'visible') apply();
  };
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    document.removeEventListener('visibilitychange', onVisible);
    root.style.fontSize = '';
  };
}
