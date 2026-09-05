import { rectOf } from './doc';
import type { CanvasNode, GroupNode, Rect } from './types';
import { rectContains } from './viewport';

/**
 * Group membership, which JSON Canvas does not store.
 *
 * The spec gives a group an id, a rectangle and a label, and nothing that says
 * which nodes are in it. Containment is therefore geometric and computed on
 * demand -- which is also why it must be computed *once, at the start of a
 * drag*: re-evaluating mid-gesture would have a group grab every card it
 * happened to slide over on the way past.
 */

export function isGroup(node: CanvasNode): node is GroupNode {
  return node.type === 'group';
}

/**
 * The nodes inside `group`.
 *
 * Fully contained, not merely intersecting. Intersection would make dragging a
 * group sweep up half the board, because a group is large and almost everything
 * clips its edge at some point.
 */
export function membersOf(
  group: GroupNode,
  nodes: readonly CanvasNode[],
): CanvasNode[] {
  const bounds = rectOf(group);
  return nodes.filter(
    (node) => node.id !== group.id && rectContains(bounds, rectOf(node)),
  );
}

/** The groups a node sits inside, innermost (smallest) first. */
export function groupsContaining(
  node: CanvasNode,
  nodes: readonly CanvasNode[],
): GroupNode[] {
  const bounds = rectOf(node);
  return nodes
    .filter(
      (other): other is GroupNode =>
        isGroup(other) &&
        other.id !== node.id &&
        rectContains(rectOf(other), bounds),
    )
    .sort((a, b) => a.width * a.height - b.width * b.height);
}

/**
 * Everything that moves when `ids` are dragged: the selection itself, plus the
 * contents of every selected group, transitively.
 *
 * Transitive because a group fully inside another is itself a member and has to
 * travel with it. Resolved by repeatedly expanding rather than recursing, which
 * cannot loop however the rectangles overlap -- a node already in the set is
 * never expanded twice.
 */
export function expandWithGroupMembers(
  ids: ReadonlySet<string>,
  nodes: readonly CanvasNode[],
): Set<string> {
  const moving = new Set(ids);
  const queue = nodes.filter((node) => ids.has(node.id) && isGroup(node));

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

/** A rectangle sized to hold `contents` with `padding` of clearance. */
export function boundsWithPadding(rect: Rect, padding: number): Rect {
  return {
    x: rect.x - padding,
    y: rect.y - padding,
    width: rect.width + padding * 2,
    height: rect.height + padding * 2,
  };
}
