import { useEffect, useRef, useState } from 'react';

import { MilkdownEditorWrapper } from '@/components/milkdown-editor';
import { useWorkspace } from '@/hooks/use-workspace';
import { isEditableCard } from '@/lib/canvas/editable';
import type { CanvasNode } from '@/lib/canvas/types';
import { useCanvasStoreApi } from '@/lib/canvas/use-canvas-store';
import { commands } from '@/lib/backend';
import { basename, joinWorkspacePath } from '@/lib/wikilink/target';
import { FileCardHeader } from './canvas-node-file';
import { CanvasTextEditor } from './canvas-text-editor';

/**
 * The editor a card gets, chosen by where its content lives.
 *
 * A **text card** holds its markdown in the `.canvas` file, so it gets a
 * lightweight editor with no autosaver -- the board's is the only writer.
 *
 * A **file card** is a view of a real note, so it gets `MilkdownEditorWrapper`
 * verbatim: everything that makes that component wrong for a text card (its
 * own autosaver, external-change watching, the command seat) is exactly right
 * here, and the note's other open tabs hear about edits as they always do.
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
    return <FileCardEditor id={node.id} file={node.file} />;
  }

  return null;
}

function FileCardEditor({ id, file }: { id: string; file: string }) {
  const store = useCanvasStoreApi();
  const workspaceRoot = useWorkspace((state) => state.path);
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const flushRef = useRef<(() => void) | null>(null);

  useFocusWhenReady(hostRef, content !== null);

  // See `registerCardFlush`. `MilkdownEditorWrapper` fills `flushRef` once its
  // editor is ready, so this forwards whatever is there when the card is asked
  // to leave edit mode.
  useEffect(
    () => store.getState().registerCardFlush(id, () => flushRef.current?.()),
    [store, id],
  );

  const absolutePath = workspaceRoot
    ? joinWorkspacePath(workspaceRoot, file)
    : null;

  // Read directly rather than through `loadEmbedSource`: an editor needs the
  // bytes it is about to write over, not a shared preview snapshot.
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
      {/* Kept while editing, or the content jumps up by its height. */}
      <FileCardHeader path={absolutePath} name={basename(file)} />
      <div ref={hostRef} className='typeset min-h-0 flex-1 overflow-auto'>
        <MilkdownEditorWrapper
          path={absolutePath}
          initialContent={content}
          onError={setError}
          flushRef={flushRef}
        />
      </div>
    </div>
  );
}

/**
 * Puts the caret in the editor as soon as one appears.
 *
 * `MilkdownEditorWrapper` builds asynchronously and does not focus itself,
 * which is right for a note tab and wrong in a card: until something inside it
 * holds focus the board does, and a Backspace then deletes the card instead of
 * a character. An observer, since there is no knowing which frame it lands on.
 */
function useFocusWhenReady(
  ref: React.RefObject<HTMLElement | null>,
  /**
   * False while the file is still being read. Without it the effect runs once,
   * on a render where the ref is attached to nothing, and never again.
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
