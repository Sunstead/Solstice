import { useEffect } from 'react';
import { Actions, type TabNode } from 'flexlayout-react';

import { useLayout } from '@/hooks/use-layout';
import { registerCommand, unregisterCommand } from '@/lib/commands';
import { handOff } from '@/lib/stores/editor-text';

type EditorConfig = { path?: string; mode?: 'source' };

/** The note in the focused tab, if that's what it shows. */
function activeNote(): TabNode | null {
  const node = useLayout.getState().model?.getActiveTabset()?.getSelectedNode() as TabNode | undefined;
  if (!node || node.getComponent() !== 'editor') return null;
  const path = (node.getConfig() as EditorConfig | undefined)?.path ?? '';
  return path.toLowerCase().endsWith('.md') ? node : null;
}

/**
 * `view.toggle_source_mode`: the focused tab's note as raw markdown, or back.
 * The mode is the tab's own (its config), so it's kept with the layout.
 */
export function useSourceModeCommand() {
  useEffect(() => {
    registerCommand(
      'view.toggle_source_mode',
      () => {
        const node = activeNote();
        const model = useLayout.getState().model;
        if (!node || !model) return;
        const config = node.getConfig() as EditorConfig;
        if (config.path) handOff(config.path);
        const mode = config.mode === 'source' ? undefined : 'source';
        model.doAction(Actions.updateNodeAttributes(node.getId(), { config: { ...config, mode } }));
        // Tab content is memoized on the node, not its config (see `retargetTabs`).
        useLayout.getState().redrawTabContent?.();
        useLayout.getState().persistCurrent();
      },
      () => activeNote() !== null,
    );
    return () => unregisterCommand('view.toggle_source_mode');
  }, []);
}
