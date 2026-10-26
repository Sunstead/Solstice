/**
 * Room at the end of a phone page's list for the iPhone's tab bar, which
 * floats over the pages (`NativeFooter`): the last row can scroll clear of
 * it. Nothing elsewhere (`.tab-bar-room`, app.css).
 *
 * It goes inside the list's own content, after its last row, not after
 * whatever holds the rows: a holder pinned to the view's height (the tree's
 * group is, to take drops on its empty space) lets the rows run past it, and
 * room after the holder ended up under them.
 */
export function TabBarRoom() {
  return <div aria-hidden data-tab-bar-room className='tab-bar-room' />;
}
