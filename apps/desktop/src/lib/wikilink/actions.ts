import { useWorkspace } from '@/hooks/use-workspace';
import { useLayout } from '@/hooks/use-layout';
import { resolveWikilink, useWikilinkIndex } from '@/lib/stores/wikilink-index';
import { requestAnchor } from '@/lib/stores/anchor';
import { joinWorkspacePath, parseWikilinkTarget, wikilinkLabel } from './target';

/**
 * Opens the file a target points at. Returns false when there is nothing to
 * open, which is the signal for callers to fall back to plain cursor
 * placement so the link can be edited instead.
 */
export function openWikilink(target: string): boolean {
  const root = useWorkspace.getState().path;
  if (!root) return false;

  // A target may carry `#heading` and `|alias`; only the path part resolves.
  const { path, heading, block } = parseWikilinkTarget(target);
  if (!path) return false;

  const resolution = resolveWikilink(path, useWikilinkIndex.getState());
  if (resolution.status !== 'resolved') return false;

  const absolute = joinWorkspacePath(root, resolution.path);
  // The editor takes it once the note is open, or at once if it already is.
  if (heading || block) requestAnchor(absolute, heading, block);
  useLayout.getState().openFile(absolute, wikilinkLabel(resolution.path));

  return true;
}