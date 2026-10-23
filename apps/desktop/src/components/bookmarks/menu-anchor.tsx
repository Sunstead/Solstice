import { createPortal } from 'react-dom';

/** An invisible box over `at`, for a menu opened from a gesture to hang from. */
export function MenuAnchor({ at, ...props }: { at: DOMRect } & React.ComponentProps<'span'>) {
  return createPortal(
    <span
      {...props}
      aria-hidden
      tabIndex={-1}
      className='pointer-events-none fixed'
      style={{ left: at.left, top: at.top, width: at.width, height: at.height }}
    />,
    document.body,
  );
}
