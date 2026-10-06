import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { openUrl } from '@/lib/backend/shell';
import { Check, Copy, ExternalLink, Link2Off, Pencil } from 'lucide-react';

import { Button } from '@sunstead/ui/components/button';
import { Input } from '@sunstead/ui/components/input';
import { isSafeExternalHref } from '@/lib/link/url';
import { useLinkEditor, type LinkTarget } from '@/lib/stores/link-editor';

/**
 * Floating editor for the link under the caret.
 *
 * Positioned against the viewport from the coordinates the tracker plugin
 * captured, rather than against the scrolling content -- the same reasoning
 * that anchors the find bar to the sticky header: the box it is measured
 * against must not move underneath it.
 */
export function LinkEditor() {
  const target = useLinkEditor((s) => s.target);
  const editing = useLinkEditor((s) => s.editing);

  if (!target) return null;

  return <LinkEditorPanel target={target} editing={editing} />;
}

function LinkEditorPanel({
  target,
  editing,
}: {
  target: LinkTarget;
  editing: boolean;
}) {
  const [draft, setDraft] = useState(target.href);
  const [copied, setCopied] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Kept on screen: a link near the right edge of a narrow window would
  // otherwise push the panel past it.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const room = window.innerWidth - 8;
    const { width } = panel.getBoundingClientRect();
    panel.style.left = `${Math.max(8, Math.min(target.rect.left, room - width))}px`;
  }, [target.rect.left, editing]);

  // Re-seed when the caret moves to a different link without closing first.
  useEffect(() => setDraft(target.href), [target.href, target.from]);

  // The confirmation tick, cancelled if the popover closes while it shows.
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(timer);
  }, [copied]);

  const apply = (href: string) => {
    const { view, from, to } = target;
    const markType = view.state.schema.marks.link;
    if (!markType) return;

    const tr = view.state.tr.removeMark(from, to, markType);
    if (href.trim()) tr.addMark(from, to, markType.create({ href: href.trim() }));

    view.dispatch(tr);
    useLinkEditor.getState().setEditing(false);
    view.focus();
  };

  return (
    <div
      ref={panelRef}
      className='fixed z-50 flex w-max max-w-[min(28rem,calc(100vw-1rem))] items-center gap-0.5 rounded-xl border bg-popover p-1 shadow-lg backdrop-blur-xl backdrop-saturate-150 animate-in fade-in-0 slide-in-from-top-1'
      style={{ top: target.rect.bottom + 6, left: target.rect.left }}
    >
      {editing ? (
        <>
          <Input
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                apply(draft);
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                useLinkEditor.getState().setEditing(false);
                target.view.focus();
              }
            }}
            className='h-7 w-72 max-w-[calc(100vw-8rem)] text-sm'
            placeholder='https://…'
          />
          <Button size='icon-sm' variant='ghost' onClick={() => apply(draft)} title='Save'>
            <Check />
          </Button>
        </>
      ) : (
        <>
          <span
            className='max-w-72 truncate px-2 text-sm text-muted-foreground'
            title={target.href}
          >
            {target.href || 'No address'}
          </span>

          {isSafeExternalHref(target.href) && (
            <Button
              size='icon-sm'
              variant='ghost'
              title='Open in browser'
              onClick={() => void openUrl(target.href)}
            >
              <ExternalLink />
            </Button>
          )}

          <Button
            size='icon-sm'
            variant='ghost'
            title='Copy address'
            onClick={() => {
              navigator.clipboard.writeText(target.href).then(
                () => setCopied(true),
                (error: unknown) => console.error('[link] copy failed', error),
              );
            }}
          >
            {copied ? <Check /> : <Copy />}
          </Button>

          <Button
            size='icon-sm'
            variant='ghost'
            title='Edit address'
            onClick={() => useLinkEditor.getState().setEditing(true)}
          >
            <Pencil />
          </Button>

          <Button
            size='icon-sm'
            variant='ghost'
            title='Remove link'
            onClick={() => apply('')}
          >
            <Link2Off />
          </Button>
        </>
      )}
    </div>
  );
}
