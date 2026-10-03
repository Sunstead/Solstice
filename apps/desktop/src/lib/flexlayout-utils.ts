import {
  Actions,
  Model,
  Orientation,
  RowNode,
  TabSetNode,
} from 'flexlayout-react';

export const TOLERANCE = 2;

export const TABSET_HEADER_SELECTOR =
  '.flexlayout__tabset_tabbar_outer, .flexlayout__tabset_header_outer';

export const DRAG_EXCLUDE_SELECTOR = [
  '.flexlayout__tab_button',
  '.flexlayout__tab_toolbar_button',
  '.no-drag',
].join(', ');

export function tagDragRegionRecursive(el: HTMLElement, enable: boolean) {
  if (el.matches(DRAG_EXCLUDE_SELECTOR)) {
    el.removeAttribute('data-tauri-drag-region');
    return;
  }

  if (enable) {
    el.setAttribute('data-tauri-drag-region', '');
  } else {
    el.removeAttribute('data-tauri-drag-region');
  }

  for (const child of Array.from(el.children)) {
    if (child instanceof HTMLElement) tagDragRegionRecursive(child, enable);
  }
}

export type TabsetCorner = 'top-left' | 'top-right';

/**
 * Walks the model's row tree to find the tabset occupying a given top
 * corner. At a horizontal row, "top-right" takes the last child and
 * "top-left" takes the first; at a vertical row, both always take the
 * first (topmost) child. If a tabset is maximized it fills the whole
 * layout, so it's returned for either corner.
 */
export function findCornerTabset(
  model: Model,
  corner: TabsetCorner,
): TabSetNode | undefined {
  const maximizedTabset = model.getMaximizedTabset();
  if (maximizedTabset) return maximizedTabset;

  let node: RowNode | TabSetNode | undefined = model.getRootRow();
  while (node instanceof RowNode) {
    const children = node.getChildren();
    if (children.length === 0) return undefined;

    const isHorz = node.getOrientation() === Orientation.HORZ;
    const pickLast = isHorz && corner === 'top-right';

    node = (pickLast ? children[children.length - 1] : children[0]) as
      | RowNode
      | TabSetNode;
  }
  return node instanceof TabSetNode ? node : undefined;
}

export function getTopEdgeTabsetIds(model: Model): Set<string> {
  const maximizedTabset = model.getMaximizedTabset();
  if (maximizedTabset) return new Set([maximizedTabset.getId()]);

  const topEdgeIds = new Set<string>();

  const visit = (node: RowNode | TabSetNode, atTopEdge: boolean) => {
    if (node instanceof TabSetNode) {
      if (atTopEdge) topEdgeIds.add(node.getId());
      return;
    }
    const isVertical = node.getOrientation() === Orientation.VERT;
    node.getChildren().forEach((child, index) => {
      visit(child as RowNode | TabSetNode, atTopEdge && (!isVertical || index === 0));
    });
  };

  const rootRow = model.getRootRow();
  if (rootRow) visit(rootRow, true);
  return topEdgeIds;
}

export function syncTopEdgeTabsetDrag(model: Model) {
  const topEdgeIds = getTopEdgeTabsetIds(model);

  model.visitNodes((node) => {
    if (!(node instanceof TabSetNode)) return;
    const desiredEnableDrag = !topEdgeIds.has(node.getId());
    if (node.isEnableDrag() !== desiredEnableDrag) {
      model.doAction(
        Actions.updateNodeAttributes(node.getId(), { enableDrag: desiredEnableDrag }),
      );
    }
  });
}

export function applyTopEdgeDragRegions(container: HTMLElement) {
  const containerRect = container.getBoundingClientRect();

  container
    .querySelectorAll<HTMLElement>(TABSET_HEADER_SELECTOR)
    .forEach((bar) => {
      const barRect = bar.getBoundingClientRect();
      const isAtTopEdge = Math.abs(barRect.top - containerRect.top) <= TOLERANCE;
      tagDragRegionRecursive(bar, isAtTopEdge);
    });
}