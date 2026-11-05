import { isOsFileDrag } from '@/lib/external-drop';

/**
 * Tells flexlayout when a drag is over, which it doesn't always work out.
 * Its drop handler returns early for a drag it had no part in (a file
 * refused, selected text moved in a note), before it zeroes the count of
 * what the drag has entered: from then on it thinks a drag is still under
 * way and never asks about another. And a drag that leaves without
 * dropping keeps its state, so the next would open the last one's file.
 *
 * Files from another app are followed out of the window, as they send no
 * `dragend`. A tab or tree drag may come back, and ends with its own.
 */
export function watchLayoutDrags(target: EventTarget, end: () => void): () => void {
  let depth = 0;

  const onEnter = (event: Event) => {
    if (isOsFileDrag((event as DragEvent).dataTransfer)) depth += 1;
  };
  const onLeave = (event: Event) => {
    if (!isOsFileDrag((event as DragEvent).dataTransfer)) return;
    depth -= 1;
    if (depth > 0) return;
    depth = 0;
    end();
  };
  const onFinished = (event: Event) => {
    // `end` itself sends an untrusted `dragend`.
    if (!event.isTrusted) return;
    depth = 0;
    end();
  };

  target.addEventListener('dragenter', onEnter);
  target.addEventListener('dragleave', onLeave);
  target.addEventListener('drop', onFinished);
  target.addEventListener('dragend', onFinished);
  return () => {
    target.removeEventListener('dragenter', onEnter);
    target.removeEventListener('dragleave', onLeave);
    target.removeEventListener('drop', onFinished);
    target.removeEventListener('dragend', onFinished);
  };
}
