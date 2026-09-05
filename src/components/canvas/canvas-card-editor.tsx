import { useEffect, useRef, useState } from 'react';

import { MilkdownEditorWrapper } from '@/components/milkdown-editor';
import { useWorkspace } from '@/hooks/use-workspace';
import { isEditableCard } from '@/lib/canvas/editable';
import type { CanvasNode } from '@/lib/canvas/types';
import { commands } from '@/bindings';
import { basename, joinWorkspacePath } from '@/lib/wikilink/target';
import { FileCardHeader } from './canvas-node-file';
import { CanvasTextEditor } from './canvas-text-editor';

/**
 * The editor a card gets, chosen by where its content actually lives.
 *
 * A **text card** holds its markdown inside the `.canvas` file, so it gets a
 * lightweight editor with no autosaver of its own -- the board's autosaver is
 * the only writer on that path.
 *
 * A **file card** is a view of a real note, so it gets `MilkdownEditorWrapper`
 * verbatim: everything that makes that component wrong for a text card (it
 * creates an autosaver for its path, watches that path for external changes,
 * takes the command seat while focused) is exactly what is wanted here. Edits
 * land in the note, and the note's other open tabs hear about them through the
 * machinery that already exists.
 */
export function CanvasCardEditor({ node }: { node: CanvasNode }) {
  if (node.type === 'text') {
    return (
      <div className='typeset h-full overflow-auto'>
        <CanvasTextEditor node={node} />
      </div>
    );
  }

  if (node.type === 'file' && isEditableCard(node)) {
    return <FileCardEditor file={node.file} />;
  }

  return null;
}

function FileCardEditor({ file }: { file: string }) {
  const workspaceRoot = useWorkspace((state) => state.path);
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);

  useFocusWhenReady(hostRef, content !== null);

  const absolutePath = workspaceRoot
    ? joinWorkspacePath(workspaceRoot, file)
    : null;

  // Read directly rather than through `loadEmbedSource`: that cache exists to
  // serve many read-only previews of one file, and an editor needs the bytes it
  // is about to start writing over, not a possibly-shared snapshot.
  useEffect(() => {
    if (!absolutePath) return;
    let cancelled = false;

    void commands.readFile(absolutePath).then((result) => {
      if (cancelled) return;
      // `typedError` resolves failures rather than rejecting, so this has to be
      // checked explicitly or an error message would be loaded as content.
      if (result.status === 'error') setError(result.error);
      else setContent(result.data);
    });

    return () => {
      cancelled = true;
    };
  }, [absolutePath]);

  if (!absolutePath) return null;

  if (error !== null) {
    return (
      <div className='p-3 text-sm text-destructive'>Failed to load: {error}</div>
    );
  }

  if (content === null) {
    return <div className='p-3 text-sm text-muted-foreground'>Loading…</div>;
  }

  return (
    <div className='flex h-full min-h-0 flex-col'>
      {/* Kept while editing, so entering edit mode does not pull the content
          up by the height of a header that vanished. */}
      <FileCardHeader path={absolutePath} name={basename(file)} />
      <div ref={hostRef} className='typeset min-h-0 flex-1 overflow-auto'>
        <MilkdownEditorWrapper
          path={absolutePath}
          initialContent={content}
          onError={setError}
        />
      </div>
    </div>
  );
}

/**
 * Puts the caret in the editor as soon as one appears.
 *
 * `MilkdownEditorWrapper` builds itself asynchronously and does not focus --
 * reasonably, since a note tab should not steal focus on open. In a card it
 * must: the card was double-clicked to type in it, and until something inside
 * it holds focus the *board* does, which means a Backspace deletes the card
 * instead of a character. An observer rather than a timeout because there is no
 * knowing which frame the editor lands on.
 */
function useFocusWhenReady(
  ref: React.RefObject<HTMLElement | null>,
  /**
   * False while the file is still being read. Without this the effect runs
   * once, on a render where the component returned its loading state and the
   * ref was attached to nothing, and never runs again.
   */
  ready: boolean,
) {
  useEffect(() => {
    const host = ref.current;
    if (!ready || !host) return;

    const focus = () => {
      const editable = host.querySelector<HTMLElement>('.ProseMirror');
      if (!editable) return false;
      editable.focus();
      return true;
    };

    if (focus()) return;

    const observer = new MutationObserver(() => {
      if (focus()) observer.disconnect();
    });
    observer.observe(host, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, [ref, ready]);
}
