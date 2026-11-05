import { CanvasEditor } from '@/components/canvas/canvas-editor';
import { FileEditor } from '@/components/file-editor';
import { ImageViewer } from '@/components/viewer/image-viewer';
import { MediaViewer } from '@/components/viewer/media-viewer';
import { PdfViewer } from '@/components/viewer/pdf-viewer';
import { UnsupportedViewer } from '@/components/viewer/unsupported-viewer';
import { fileViewKind, isDrawing, isTaskBoard } from '@/lib/embed/kind';
import { CodeFileView } from '@/components/code-file-view';
import { TaskBoardView } from '@/components/task-board/task-board-view';
import { can } from '@/lib/backend/platform';
import { NativePdf } from '@/components/viewer/native-pdf';
import { NativeDrawing } from '@/components/viewer/native-drawing';
import { NativeImage } from '@/components/viewer/native-image';
import { isMarkableImage } from '@/lib/ink/insert';

type FileViewProps = {
  path: string;
  source?: boolean;
  /** The tab's id and chosen language, for a code file. */
  tabId?: string;
  language?: string;
};

/**
 * Chooses what a tab actually shows.
 *
 * Every tab used to render `FileEditor`, which reads its file as UTF-8 -- so
 * opening a `.png` from the explorer failed with a decode error rather than
 * showing the image. Classification reuses the embed table, so a file type
 * that can be embedded in a note can also be opened on its own; code and
 * text open in a code tab.
 */
export const FileView: React.FC<FileViewProps> = ({ path, source = false, tabId, language }) => {
  // An empty config path is a tab pointing at nothing.
  if (!path) return <UnsupportedViewer path='' />;

  // A drawing is an SVG to everything but the iOS app, which draws on it.
  if (can.nativeViews && isDrawing(path)) return <NativeDrawing path={path} />;

  switch (fileViewKind(path)) {
    case 'markdown':
      // A board's other mode is its source, never rich text.
      if (isTaskBoard(path) && !source) return <TaskBoardView key={`board:${path}`} path={path} />;
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
    case 'code':
      return <CodeFileView key={`code:${path}`} path={path} tabId={tabId} language={language} />;
    default:
      // Opened as text if it reads as text.
      return <CodeFileView key={`probe:${path}`} path={path} tabId={tabId} language={language} probe />;
  }
};
