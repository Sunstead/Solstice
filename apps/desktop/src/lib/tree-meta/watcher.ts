import type { FsChange, TreeMetaOp } from '@/bindings';
import { toRel } from './ops';

/**
 * What a batch from the file watcher does to bookmarks and folder colours.
 * Only renames carry them; a removal never forgets one (the view hides it),
 * since a file that vanished here may only be moving.
 *
 * In a synced folder, sync renames files one at a time on the devices it
 * reaches, and the device that renamed them already moved their bookmarks:
 * writing it again here could undo a later rename there. A folder renamed
 * whole can only have been renamed on this device (outside the app), and
 * folders aren't in the vault, so those are carried.
 */
export function opsFromWatcher(changes: FsChange[], root: string, linked: boolean): TreeMetaOp[] {
  const ops: TreeMetaOp[] = [];
  for (const change of changes) {
    if (change.kind !== 'Renamed' || !change.from) continue;
    if (linked && !change.entry?.is_dir) continue;
    const from = toRel(root, change.from);
    const to = toRel(root, change.path);
    if (!from || !to || from === to) continue;
    if ([from, to].some((p) => p.split('/').some((s) => s.startsWith('.')))) continue;
    ops.push({ op: 'retarget', from, to });
  }
  return ops;
}
