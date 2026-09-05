import { useEffect, useRef } from 'react';

import { useWorkspace } from '@/hooks/use-workspace';
import { renderMarkdownFragment } from '@/lib/editor/static-markdown';
import { cn } from '@/lib/utils';

/**
 * Markdown rendered read-only, exactly as a note would render it.
 *
 * The DOM is owned by the effect rather than by React: the renderer hands back
 * a `DocumentFragment` built from the editor's own schema, and reconciling that
 * against JSX children would mean rebuilding it as React elements and keeping
 * the two definitions of "what a callout looks like" in step forever.
 * `Transclusion` in `embed-view.tsx` does the same thing for the same reason.
 */
export function StaticMarkdown({
  markdown,
  sourcePath,
  className,
}: {
  markdown: string;
  /** What relative links resolve against: the `.canvas` file's own path. */
  sourcePath: string;
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const workspaceRoot = useWorkspace((state) => state.path);

  useEffect(() => {
    let cancelled = false;

    // `Editor.create()` is async, so this always resolves a tick late. The tab
    // warms the renderer on mount, which makes that a microtask rather than
    // anything visible.
    void renderMarkdownFragment(markdown, { sourcePath, workspaceRoot }).then(
      (fragment) => {
        if (cancelled) return;
        const host = hostRef.current;
        if (!host) return;

        // No renderer means showing the source, which is still the content --
        // better than an empty card that looks like data loss.
        if (fragment) host.replaceChildren(fragment);
        else host.textContent = markdown;
      },
    );

    return () => {
      cancelled = true;
    };
  }, [markdown, sourcePath, workspaceRoot]);

  return <div ref={hostRef} className={cn('typeset', className)} />;
}
