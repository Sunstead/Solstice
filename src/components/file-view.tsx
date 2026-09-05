import { CanvasEditor } from '@/components/canvas/canvas-editor';
import { FileEditor } from '@/components/file-editor';
import { ImageViewer } from '@/components/viewer/image-viewer';
import { MediaViewer } from '@/components/viewer/media-viewer';
import { PdfViewer } from '@/components/viewer/pdf-viewer';
import { UnsupportedViewer } from '@/components/viewer/unsupported-viewer';
import { embedKind } from '@/lib/embed/kind';

/**
 * Chooses what a tab actually shows.
 *
 * Every tab used to render `FileEditor`, which reads its file as UTF-8 -- so
 * opening a `.png` from the explorer failed with a decode error rather than
 * showing the image. Classification reuses the embed table, so a file type
 * that can be embedded in a note can also be opened on its own.
 */
export const FileView: React.FC<{ path: string }> = ({ path }) => {
  // An empty config path is a tab pointing at nothing; `embedKind` calls that
  // a note (extensionless targets are notes) and would boot an editor over it.
  if (!path) return <UnsupportedViewer path='' />;

  switch (embedKind(path)) {
    case 'markdown':
      return <FileEditor path={path} />;
    case 'image':
      return <ImageViewer path={path} />;
    case 'video':
      return <MediaViewer path={path} kind='video' />;
    case 'audio':
      return <MediaViewer path={path} kind='audio' />;
    case 'pdf':
      return <PdfViewer path={path} />;
    case 'canvas':
      return <CanvasEditor path={path} />;
    default:
      return <UnsupportedViewer path={path} />;
  }
};
