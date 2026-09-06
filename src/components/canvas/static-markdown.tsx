import { useEffect, useRef } from 'react';

import { useWorkspace } from '@/hooks/use-workspace';
import { renderMarkdownFragment } from '@/lib/editor/static-markdown';
import { cn } from '@/lib/utils';

/**
 * Markdown rendered read-only, as a note would render it.
 *
 * The effect owns the DOM rather than React: the renderer returns a
 * `DocumentFragment` built from the editor's own schema, and reconciling that
 * against JSX would mean maintaining a second definition of every node type.
 * `Transclusion` in `embed-view.tsx` works the same way.
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

    // `Editor.create()` is async, so this resolves a tick late; the tab warms
    // the renderer on mount to keep that invisible.
    void renderMarkdownFragment(markdown, { sourcePath, workspaceRoot }).then(
      (fragment) => {
        if (cancelled) return;
        const host = hostRef.current;
        if (!host) return;

        // No renderer: show the source, rather than an empty card that reads
        // as data loss.
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
