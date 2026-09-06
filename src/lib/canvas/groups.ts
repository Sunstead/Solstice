import { rectOf } from './doc';
import type { CanvasNode, GroupNode } from './types';
import { rectContains } from './viewport';

/**
 * Group membership, which JSON Canvas does not store -- a group is just a
 * labelled rectangle, so membership is geometric and computed on demand.
 */

function isGroup(node: CanvasNode): node is GroupNode {
  return node.type === 'group';
}

/**
 * The nodes inside `group`. Fully contained, not merely intersecting: a group
 * is large, and intersection would sweep up half the board.
 */
function membersOf(group: GroupNode, nodes: readonly CanvasNode[]): CanvasNode[] {
  const bounds = rectOf(group);
  return nodes.filter(
    (node) => node.id !== group.id && rectContains(bounds, rectOf(node)),
  );
}

/**
 * Everything that moves when `ids` are dragged: the selection, plus the
 * contents of every selected group, transitively -- a group inside another is
 * itself a member and travels with it.
 *
 * Callers must resolve this once at the start of a gesture. Re-running it
 * mid-drag would have a group capture whatever it slid over on the way past.
 */
export function expandWithGroupMembers(
  ids: ReadonlySet<string>,
  nodes: readonly CanvasNode[],
): Set<string> {
  const moving = new Set(ids);
  const queue = nodes.filter((node) => ids.has(node.id) && isGroup(node));

  // Iterative rather than recursive so overlapping rectangles cannot loop: a
  // node already in the set is never expanded twice.
  while (queue.length > 0) {
    const group = queue.pop() as GroupNode;

    for (const member of membersOf(group, nodes)) {
      if (moving.has(member.id)) continue;
      moving.add(member.id);
      if (isGroup(member)) queue.push(member);
    }
  }

  return moving;
}
