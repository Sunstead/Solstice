import { ExternalLink, Link2 } from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';

import { isSafeExternalHref } from '@/lib/link/url';
import type { LinkNode } from '@/lib/canvas/types';

/**
 * The URL as something a browser will take. JSON Canvas stores whatever was
 * typed, and `example.com` is pasted as readily as `https://example.com`.
 */
function linkHref(url: string): string {
  const trimmed = url.trim();
  if (trimmed === '') return '';
  return /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** The scheme-less forms people paste, which `new URL` will not take as-is. */
export function hostnameOf(url: string): string | null {
  const href = linkHref(url);
  if (href === '') return null;

  try {
    return new URL(href).hostname;
  } catch {
    return null;
  }
}

/**
 * Opens a link card's URL, guarded so only safe schemes reach the OS.
 *
 * Not gated on `links.openExternalInBrowser`: that setting exists so a click
 * in prose can place a caret instead of navigating, and a card has no caret --
 * honouring it here would leave a link card inert.
 */
export function openLinkNode(url: string): void {
  const href = linkHref(url);
  if (!isSafeExternalHref(href)) return;
  void openUrl(href);
}

/**
 * A bookmark card: the host and the URL, nothing else. No favicon, which would
 * mean a local-first app reporting every domain in every board to a third
 * party the moment one is opened.
 */
export function CanvasNodeLink({ node }: { node: LinkNode }) {
  const host = hostnameOf(node.url);
  const openable = isSafeExternalHref(linkHref(node.url));

  return (
    <div className='flex h-full min-h-0 flex-col'>
      {/* The same header shape a file card has. The body is not clickable: a
          press there selects and drags the card. */}
      <div className='flex shrink-0 items-center gap-1.5 border-b px-2 py-1 text-xs text-muted-foreground'>
        <Link2 className='size-3.5 shrink-0' />
        <span className='min-w-0 flex-1 truncate'>{host ?? 'Link'}</span>
        {openable && (
          <button
            type='button'
            title='Open in browser'
            aria-label='Open in browser'
            className='shrink-0 rounded-sm p-0.5 hover:bg-accent hover:text-accent-foreground'
            // Or the board's delegated handler starts dragging the card.
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              openLinkNode(node.url);
            }}
          >
            <ExternalLink className='size-3.5' />
          </button>
        )}
      </div>

      <div className='flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-3 text-center'>
        <Link2 className='size-8 shrink-0 text-muted-foreground' />
        <p className='text-xs break-all text-muted-foreground'>
          {node.url || 'No URL'}
        </p>
      </div>
    </div>
  );
}
