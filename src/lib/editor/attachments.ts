import { commands } from '@/bindings';
import { applyFsChanges, selfChange } from '@/lib/fs-sync';
import { joinPath, parentOf, relativeFromDirectory } from '@/lib/path-utils';
import { getSetting } from '@/lib/settings/store';
import { useWorkspace } from '@/hooks/use-workspace';

/** Extensions for the image types a clipboard realistically produces. */
const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
};

export interface SavedAttachment {
  /** What to write into the markdown, relative to the note. */
  src: string;
  absolutePath: string;
}

/**
 * A folder setting is user-typed, so it has to survive `/leading`, `trailing/`
 * and `..` escapes -- an attachment must land inside the workspace whatever
 * was typed.
 */
function normalizeFolder(raw: string): string {
  return raw
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment && segment !== '.' && segment !== '..')
    .join('/');
}

/** Where a new attachment is written, per `attachments.location`. */
function attachmentDirectory(notePath: string, workspaceRoot: string): string {
  const folder = normalizeFolder(getSetting('attachments.folder'));
  const noteDir = parentOf(notePath);

  switch (getSetting('attachments.location')) {
    case 'next-to-note':
      return noteDir;
    case 'note-subfolder':
      return folder ? joinPath(noteDir, folder) : noteDir;
    default:
      return folder ? joinPath(workspaceRoot, folder) : workspaceRoot;
  }
}

/**
 * `Pasted image 20260829143502.png`. A clipboard image has no name of its own,
 * and a timestamp both sorts chronologically and cannot collide in practice.
 */
function pastedImageName(mime: string): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

  return `Pasted image ${stamp}.${MIME_EXTENSIONS[mime] ?? 'png'}`;
}

/**
 * Announcing the write through `applyFsChanges` is what puts the new file into
 * the explorer and, more importantly, into the wikilink index that
 * `resolveAsset` reads -- without it a freshly added image would render as
 * missing until the next unrelated filesystem event.
 */
async function announce(
  absolutePath: string,
  notePath: string,
): Promise<SavedAttachment> {
  await applyFsChanges([selfChange('Created', absolutePath)]);

  return {
    absolutePath,
    src: relativeFromDirectory(parentOf(notePath), absolutePath),
  };
}

/**
 * Copies a pasted or dropped file into the workspace and reports where to
 * point the link. The backend picks the final name, so a collision is resolved
 * in the same step as the write.
 */
export async function saveAttachment(
  file: File,
  notePath: string,
): Promise<SavedAttachment | null> {
  const workspaceRoot = useWorkspace.getState().path;
  if (!workspaceRoot) return null;

  const directory = attachmentDirectory(notePath, workspaceRoot);
  const name = file.name || pastedImageName(file.type);

  // Bytes cross the IPC boundary as a JSON number array, which is the only
  // shape the generated bindings can express. Fine at attachment sizes, and
  // the reason `importAttachment` exists for files already on disk.
  const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
  const result = await commands.saveAttachment(directory, name, bytes);

  if (result.status === 'error') {
    console.error(`[attachments] failed to save "${name}":`, result.error);
    return null;
  }

  return announce(result.data, notePath);
}

/** The same, for a file picked from disk -- copied backend-side. */
export async function importAttachment(
  sourcePath: string,
  notePath: string,
): Promise<SavedAttachment | null> {
  const workspaceRoot = useWorkspace.getState().path;
  if (!workspaceRoot) return null;

  const directory = attachmentDirectory(notePath, workspaceRoot);
  const result = await commands.importAttachment(sourcePath, directory);

  if (result.status === 'error') {
    console.error(`[attachments] failed to import "${sourcePath}":`, result.error);
    return null;
  }

  return announce(result.data, notePath);
}
