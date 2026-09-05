import { ExternalLink, Link2 } from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';

import { isSafeExternalHref } from '@/lib/link/url';
import type { LinkNode } from '@/lib/canvas/types';

/**
 * The URL as something a browser will take.
 *
 * People paste `example.com` as readily as `https://example.com`, and JSON
 * Canvas stores whatever they typed. Assuming https for a scheme-less value is
 * what every address bar does.
 */
export function linkHref(url: string): string {
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
 * Opens a link card's URL.
 *
 * Guarded by `isSafeExternalHref`, so only schemes a browser should be handed
 * ever reach the OS. Deliberately *not* gated on `links.openExternalInBrowser`
 * the way a link inside a note is: that setting exists so a plain click in
 * prose can place the caret instead of navigating, and a card has no caret and
 * no other purpose -- honouring it here would leave a link card inert with no
 * way to reach what it points at.
 */
export function openLinkNode(url: string): void {
  const href = linkHref(url);
  if (!isSafeExternalHref(href)) return;
  void openUrl(href);
}

/**
 * A bookmark card.
 *
 * Shows the host and the URL, and nothing else. The obvious embellishment is a
 * favicon, but every implementation of that fetches it from a third party --
 * which would have a local-first notes app quietly telling Google's favicon
 * service every domain in every board the moment one is opened. Not worth a
 * 16px image.
 */
export function CanvasNodeLink({ node }: { node: LinkNode }) {
  const host = hostnameOf(node.url);
  const openable = isSafeExternalHref(linkHref(node.url));

  return (
    <div className='flex h-full min-h-0 flex-col'>
      {/* The same header shape a file card has: what this is, and a way to
          reach it. A card's body is not clickable, because a click there
          selects and drags the card itself. */}
      <div className='flex shrink-0 items-center gap-1.5 border-b px-2 py-1 text-xs text-muted-foreground'>
        <Link2 className='size-3.5 shrink-0' />
        <span className='min-w-0 flex-1 truncate'>{host ?? 'Link'}</span>
        {openable && (
          <button
            type='button'
            title='Open in browser'
            aria-label='Open in browser'
            className='shrink-0 rounded-sm p-0.5 hover:bg-accent hover:text-accent-foreground'
            // The board's delegated handler would otherwise read this as a
            // press on the card and start dragging it.
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
