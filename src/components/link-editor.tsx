import { useEffect, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Check, Copy, ExternalLink, Link2Off, Pencil } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

  // Re-seed when the caret moves to a different link without closing first.
  useEffect(() => setDraft(target.href), [target.href, target.from]);

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
      className='fixed z-50 flex w-max max-w-md items-center gap-0.5 rounded-xl border bg-popover p-1 shadow-lg backdrop-blur-xl backdrop-saturate-150 animate-in fade-in-0 slide-in-from-top-1'
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
            className='h-7 w-72 text-sm'
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
              void navigator.clipboard.writeText(target.href).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              });
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
