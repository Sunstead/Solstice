import { useWorkspace } from '@/hooks/use-workspace';
import { useLayout } from '@/hooks/use-layout';
import { resolveWikilink, useWikilinkIndex } from '@/lib/stores/wikilink-index';
import { joinWorkspacePath, wikilinkLabel } from './target';

/**
 * Opens the file a target points at. Returns false when there is nothing to
 * open, which is the signal for callers to fall back to plain cursor
 * placement so the link can be edited instead.
 */
export function openWikilink(target: string): boolean {
  const root = useWorkspace.getState().path;
  if (!root) return false;

  const resolution = resolveWikilink(target, useWikilinkIndex.getState());
  if (resolution.status !== 'resolved') return false;

  useLayout
    .getState()
    .openFile(
      joinWorkspacePath(root, resolution.path),
      wikilinkLabel(resolution.path),
    );

  return true;
}