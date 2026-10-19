import { CanvasEditor } from '@/components/canvas/canvas-editor';
import { FileEditor } from '@/components/file-editor';
import { ImageViewer } from '@/components/viewer/image-viewer';
import { MediaViewer } from '@/components/viewer/media-viewer';
import { PdfViewer } from '@/components/viewer/pdf-viewer';
import { UnsupportedViewer } from '@/components/viewer/unsupported-viewer';
import { embedKind, isDrawing } from '@/lib/embed/kind';
import { can } from '@/lib/backend/platform';
import { NativePdf } from '@/components/viewer/native-pdf';
import { NativeDrawing } from '@/components/viewer/native-drawing';
import { NativeImage } from '@/components/viewer/native-image';
import { isMarkableImage } from '@/lib/ink/insert';

/**
 * Chooses what a tab actually shows.
 *
 * Every tab used to render `FileEditor`, which reads its file as UTF-8 -- so
 * opening a `.png` from the explorer failed with a decode error rather than
 * showing the image. Classification reuses the embed table, so a file type
 * that can be embedded in a note can also be opened on its own.
 */
export const FileView: React.FC<{ path: string; source?: boolean }> = ({ path, source = false }) => {
  // An empty config path is a tab pointing at nothing; `embedKind` calls that
  // a note (extensionless targets are notes) and would boot an editor over it.
  if (!path) return <UnsupportedViewer path='' />;

  // A drawing is an SVG to everything but the iOS app, which draws on it.
  if (can.nativeViews && isDrawing(path)) return <NativeDrawing path={path} />;

  switch (embedKind(path)) {
    case 'markdown':
      // Keyed, so another file or mode starts afresh.
      return <FileEditor key={`${source ? 'source' : 'rich'}:${path}`} path={path} source={source} />;
    case 'image':
      // On iOS a bitmap is marked up in place, as in Preview.
      return can.nativeViews && isMarkableImage(path) ? <NativeImage path={path} /> : <ImageViewer path={path} />;
    case 'video':
      return <MediaViewer path={path} kind='video' />;
    case 'audio':
      return <MediaViewer path={path} kind='audio' />;
    case 'pdf':
      // On iOS, in PDFKit: Apple's scrolling, zoom and selection.
      return can.nativeViews ? <NativePdf path={path} /> : <PdfViewer path={path} />;
    case 'canvas':
      return <CanvasEditor path={path} />;
    default:
      return <UnsupportedViewer path={path} />;
  }
};
