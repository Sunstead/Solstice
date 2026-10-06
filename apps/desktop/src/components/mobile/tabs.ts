import { type Model, TabNode, TabSetNode } from 'flexlayout-react';
import { stripPresetExtension } from '@/lib/stores/entry-input';

/** Every open tab, across every tabset, in layout order. */
export function allTabs(model: Model): TabNode[] {
  const tabs: TabNode[] = [];
  model.visitNodes((node) => {
    if (node instanceof TabNode) tabs.push(node);
  });
  return tabs;
}

/**
 * The tab the phone layout shows: the active tabset's selected tab, or failing
 * that the first selected tab anywhere, or the first tab at all.
 */
export function shownTab(model: Model): TabNode | null {
  const selected = model.getActiveTabset()?.getSelectedNode();
  if (selected instanceof TabNode) return selected;
  let found: TabNode | null = null;
  model.visitNodes((node) => {
    if (!found && node instanceof TabSetNode) {
      const s = node.getSelectedNode();
      if (s instanceof TabNode) found = s;
    }
  });
  return found ?? allTabs(model)[0] ?? null;
}

/** A tab's name as the tab strip shows it. */
export function tabTitle(tab: TabNode, showExtensions: boolean): string {
  return showExtensions ? tab.getName() : stripPresetExtension(tab.getName()).name;
}
