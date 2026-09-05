import { useEffect, useState } from 'react';
import { ExternalLink, ImageOff } from 'lucide-react';

import { getFileIcon } from '@/assets/icons';
import { FormattedFileName } from '@/components/file-tree';
import { MediaPlayer } from '@/components/viewer/media-player';
import { PdfPreviewCard } from '@/components/viewer/pdf-preview-card';
import { useLayout } from '@/hooks/use-layout';
import { useWorkspace } from '@/hooks/use-workspace';
import { embedKind } from '@/lib/embed/kind';
import {
  loadEmbedSource,
  sliceSection,
  subscribeToEmbedSources,
} from '@/lib/embed/source';
import type { FileNode } from '@/lib/canvas/types';
import { getFileExtension } from '@/lib/utils';
import { useAssetUrl } from '@/lib/viewer/asset';
import { basename, joinWorkspacePath } from '@/lib/wikilink/target';
import { StaticMarkdown } from './static-markdown';

/**
 * A file card, showing the file.
 *
 * Dispatches through `embedKind` -- the same table that decides what a tab
 * renders and what `![[target]]` renders in a note -- so a card showing a file
 * shows the same thing every other surface in the app would. A card that only
 * showed an icon and a filename was, reasonably, read as broken.
 *
 * The path in the document is relative to the vault root, which is what JSON
 * Canvas stores and what Obsidian writes; an absolute one would break the
 * moment the vault moved.
 */
export function CanvasNodeFile({ node }: { node: FileNode }) {
  const workspaceRoot = useWorkspace((state) => state.path);

  if (!node.file) {
    return (
      <div className='flex h-full items-center justify-center text-sm text-muted-foreground'>
        No file
      </div>
    );
  }

  const absolutePath = workspaceRoot
    ? joinWorkspacePath(workspaceRoot, node.file)
    : null;

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <FileCardHeader path={absolutePath} name={basename(node.file)} />
      <div className='min-h-0 flex-1 overflow-hidden'>
        {absolutePath ? (
          <FileCardBody
            absolutePath={absolutePath}
            subpath={node.subpath}
            file={node.file}
          />
        ) : (
          <Fallback file={node.file} />
        )}
      </div>
    </div>
  );
}

/**
 * The filename, and a way into the real file.
 *
 * A card is a view of a file, not the file itself -- there has to be a route to
 * the thing it is showing, and the card's own body is taken up by content.
 */
export function FileCardHeader({
  path,
  name,
}: {
  path: string | null;
  name: string;
}) {
  // The same icon and the same name formatting a tab and the breadcrumb use, so
  // one file looks like itself wherever it appears -- including obeying
  // `explorer.showFileExtensions`, which `FormattedFileName` reads.
  const Icon = getFileIcon(getFileExtension(name));

  return (
    <div
      data-canvas-chrome
      className='flex shrink-0 items-center gap-1.5 border-b px-2 py-1 text-xs text-muted-foreground'
    >
      <Icon className='size-3.5 shrink-0' />
      <FormattedFileName name={name} />
      {path && (
        <button
          type='button'
          title='Open in a tab'
          aria-label='Open in a tab'
          className='shrink-0 rounded-sm p-0.5 hover:bg-accent hover:text-accent-foreground'
          // The board's delegated handler would otherwise read this as a press
          // on the card and start dragging it.
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            useLayout.getState().openFile(path, name);
          }}
        >
          <ExternalLink className='size-3.5' />
        </button>
      )}
    </div>
  );
}

function FileCardBody({
  absolutePath,
  subpath,
  file,
}: {
  absolutePath: string;
  subpath?: string;
  file: string;
}) {
  const kind = embedKind(absolutePath);

  switch (kind) {
    case 'markdown':
      return <MarkdownBody absolutePath={absolutePath} subpath={subpath} />;
    case 'image':
      return <ImageBody absolutePath={absolutePath} file={file} />;
    case 'video':
    case 'audio':
      return <MediaBody absolutePath={absolutePath} kind={kind} />;
    case 'pdf':
      return (
        <div className='size-full overflow-hidden'>
          <PdfPreviewCard path={absolutePath} />
        </div>
      );
    default:
      // Including `canvas`: a board inside a board inside a board is a depth
      // problem the preview card guards, but the guard needs a chain context
      // this card is not inside. An icon is honest until that is wired.
      return <Fallback file={file} />;
  }
}

/**
 * A note's content, rendered read-only.
 *
 * `loadEmbedSource` is the same cache note transclusions use: a file shown on
 * several cards is read once, it invalidates on `fileSystemChanged`, and it
 * hears about this app's own writes -- so a card stays current while the same
 * note is edited in another tab.
 */
function MarkdownBody({
  absolutePath,
  subpath,
}: {
  absolutePath: string;
  subpath?: string;
}) {
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const read = () => {
      void loadEmbedSource(absolutePath).then((text) => {
        if (cancelled) return;
        setMissing(text === null);
        setMarkdown(text);
      });
    };

    read();
    const unsubscribe = subscribeToEmbedSources(read);

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [absolutePath]);

  if (missing) {
    return (
      <div className='flex h-full items-center justify-center p-3 text-sm text-muted-foreground'>
        File not found
      </div>
    );
  }

  if (markdown === null) return null;

  // `subpath` is a heading or block reference and always starts with `#`.
  const heading = subpath?.startsWith('#') ? subpath.slice(1) : null;
  const body = heading === null ? markdown : sliceSection(markdown, heading);

  if (body === null) {
    return (
      <div className='flex h-full items-center justify-center p-3 text-sm text-muted-foreground'>
        No section &ldquo;{heading}&rdquo;
      </div>
    );
  }

  return (
    <StaticMarkdown
      markdown={body}
      sourcePath={absolutePath}
      className='h-full overflow-hidden p-3'
    />
  );
}

function ImageBody({
  absolutePath,
  file,
}: {
  absolutePath: string;
  file: string;
}) {
  const asset = useAssetUrl(absolutePath);

  if (asset.status === 'error') {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-2 text-muted-foreground'>
        <ImageOff className='size-6' />
        <p className='text-xs'>Could not load</p>
      </div>
    );
  }

  if (asset.status !== 'ready') return null;

  return (
    <img
      src={asset.url}
      alt={basename(file)}
      draggable={false}
      // `contain` rather than `cover`: a card is a view of the whole picture,
      // and cropping it to fill would hide whatever the card was made for.
      className='size-full object-contain select-none'
    />
  );
}

function MediaBody({
  absolutePath,
  kind,
}: {
  absolutePath: string;
  kind: 'video' | 'audio';
}) {
  const asset = useAssetUrl(absolutePath);
  if (asset.status !== 'ready') return null;

  return (
    <div className='flex h-full items-center justify-center p-2'>
      <MediaPlayer
        src={asset.url}
        kind={kind}
        density='compact'
        className='w-full'
      />
    </div>
  );
}

function Fallback({ file }: { file: string }) {
  const Icon = getFileIcon(getFileExtension(file));

  return (
    <div className='flex h-full flex-col items-center justify-center gap-2 px-2 text-center'>
      <Icon className='size-8 shrink-0' />
      <div className='max-w-full text-xs text-muted-foreground'>
        <FormattedFileName name={basename(file)} />
      </div>
    </div>
  );
}
