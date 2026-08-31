import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useNodeViewContext } from '@prosemirror-adapter/react';
import { editorViewCtx, parserCtx } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import { DOMSerializer } from '@milkdown/kit/prose/model';
import { openPath } from '@tauri-apps/plugin-opener';
import { FileWarning, Link2Off, RefreshCcw } from 'lucide-react';

import { useWorkspace } from '@/hooks/use-workspace';
import { embedKind } from '@/lib/embed/kind';
import {
  loadEmbedSource,
  sliceSection,
  subscribeToEmbedSources,
} from '@/lib/embed/source';
import { resolveAsset } from '@/lib/image/resolve';
import { useWikilinkIndex } from '@/lib/stores/wikilink-index';
import { basename, parseWikilinkTarget, wikilinkLabel } from '@/lib/wikilink/target';
import { parseSize } from '@/lib/image/size';
import { cn } from '@/lib/utils';
import { useEditorNotePath } from './editor-file-context';

/**
 * Absolute paths of the notes this embed is rendered inside, outermost first.
 *
 * A note that transcludes itself -- directly or through a chain -- would
 * otherwise recurse until the renderer gives out. The depth cap is a second
 * guard: a rename can create a cycle between two renders, and the chain check
 * alone would not have seen it yet.
 */
const EmbedChainContext = createContext<readonly string[]>([]);

const MAX_EMBED_DEPTH = 3;

/**
 * Rewrites links inside transcluded content, which was written relative to the
 * *embedded* note rather than to the one displaying it.
 *
 * Static serialization is used rather than a nested editor: a second Milkdown
 * instance per embed would bring its own autosaver, command surface and undo
 * history, none of which a read-only preview should own.
 */
function rewriteTransclusion(
  fragment: ParentNode,
  sourcePath: string,
  workspaceRoot: string | null,
) {
  const index = useWikilinkIndex.getState();

  for (const image of Array.from(fragment.querySelectorAll('img[src]'))) {
    const asset = resolveAsset(
      image.getAttribute('src') ?? '',
      { notePath: sourcePath, workspaceRoot },
      index,
    );

    if (asset.status === 'unresolved') image.removeAttribute('src');
    else image.setAttribute('src', asset.url);
  }

  // Wikilinks serialize as their literal `[[target]]` source. In a preview
  // there is nothing to edit, so show what a collapsed link would show.
  for (const link of Array.from(fragment.querySelectorAll('[data-wikilink]'))) {
    const raw = link.textContent ?? '';
    const target = raw.slice(2, -2);
    link.textContent = wikilinkLabel(parseWikilinkTarget(target).path);
    link.classList.add('wikilink', 'wikilink-resolved');
  }
}

export function createEmbedView(ctx: Ctx): React.FC {
  return function EmbedView() {
    const { node, selected } = useNodeViewContext();
    const notePath = useEditorNotePath();
    const workspaceRoot = useWorkspace((s) => s.path);
    const index = useWikilinkIndex();
    const chain = useContext(EmbedChainContext);

    const value: string = node.attrs.value;
    const parts = useMemo(() => parseWikilinkTarget(value), [value]);

    const asset = useMemo(
      () => resolveAsset(parts.path, { notePath, workspaceRoot }, index),
      [parts.path, notePath, workspaceRoot, index],
    );

    const absolutePath = asset.status === 'resolved' ? asset.absolutePath : null;
    const kind = absolutePath ? embedKind(absolutePath) : 'unknown';
    const { width, height } = parseSize(parts.suffix);

    const sizeStyle = {
      width: width === null ? undefined : `${width}px`,
      height: height === null ? undefined : `${height}px`,
    };

    const cyclic = absolutePath !== null && chain.includes(absolutePath);
    const tooDeep = chain.length >= MAX_EMBED_DEPTH;

    if (asset.status === 'unresolved') {
      return (
        <Chip selected={selected} icon={<Link2Off className='size-3.5 shrink-0' />}>
          {value || 'Empty embed'}
        </Chip>
      );
    }

    if (kind === 'markdown' && (cyclic || tooDeep)) {
      return (
        <Chip selected={selected} icon={<RefreshCcw className='size-3.5 shrink-0' />}>
          {cyclic ? 'Circular embed' : 'Embed nested too deeply'}: {value}
        </Chip>
      );
    }

    const url = asset.status === 'resolved' ? asset.url : '';

    return (
      <span
        className={cn('solstice-embed', selected && 'is-selected')}
        data-embed-kind={kind}
        contentEditable={false}
      >
        {kind === 'image' && <img src={url} alt={value} style={sizeStyle} />}

        {kind === 'video' && <video src={url} controls style={sizeStyle} />}

        {kind === 'audio' && <audio src={url} controls />}

        {kind === 'pdf' && (
          <iframe
            src={url}
            title={value}
            style={{ ...sizeStyle, height: height === null ? '32rem' : `${height}px` }}
          />
        )}

        {kind === 'markdown' && absolutePath && (
          <EmbedChainContext.Provider value={[...chain, absolutePath]}>
            <Transclusion
              ctx={ctx}
              absolutePath={absolutePath}
              heading={parts.heading}
              workspaceRoot={workspaceRoot}
            />
          </EmbedChainContext.Provider>
        )}

        {kind === 'unknown' && absolutePath && (
          <button
            type='button'
            data-not-typeset
            className='solstice-embed-file'
            onClick={() => void openPath(absolutePath)}
          >
            <FileWarning className='size-3.5 shrink-0' />
            <span className='truncate'>{basename(absolutePath)}</span>
          </button>
        )}
      </span>
    );
  };
}

function Chip({
  icon,
  selected,
  children,
}: {
  icon: React.ReactNode;
  selected: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      data-not-typeset
      contentEditable={false}
      className={cn('solstice-embed-missing', selected && 'is-selected')}
    >
      {icon}
      <span className='truncate'>{children}</span>
    </span>
  );
}

function Transclusion({
  ctx,
  absolutePath,
  heading,
  workspaceRoot,
}: {
  ctx: Ctx;
  absolutePath: string;
  heading: string | null;
  workspaceRoot: string | null;
}) {
  const [markdown, setMarkdown] = useState<string | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    const read = () => {
      void loadEmbedSource(absolutePath).then((text) => {
        if (!cancelled) setMarkdown(text);
      });
    };

    read();
    const unsubscribe = subscribeToEmbedSources(read);

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [absolutePath]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    if (markdown === null) {
      host.replaceChildren();
      return;
    }

    const body = heading === null ? markdown : sliceSection(markdown, heading);

    if (body === null) {
      host.textContent = `No section "${heading}" in ${basename(absolutePath)}`;
      return;
    }

    const doc = ctx.get(parserCtx)(body);
    if (!doc) return;

    const schema = ctx.get(editorViewCtx).state.schema;
    const fragment = DOMSerializer.fromSchema(schema).serializeFragment(doc.content);
    rewriteTransclusion(fragment, absolutePath, workspaceRoot);

    host.replaceChildren(fragment);
  }, [ctx, markdown, heading, absolutePath, workspaceRoot]);

  return <div ref={hostRef} className='solstice-embed-note' />;
}
