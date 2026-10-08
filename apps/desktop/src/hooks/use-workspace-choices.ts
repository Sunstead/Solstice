import { CloudDownload, FolderOpen, Plus, Settings2, type LucideIcon } from 'lucide-react';

import { useWorkspace } from '@/hooks/use-workspace';
import { can } from '@/lib/backend/platform';
import { useKnownWorkspaces } from '@/lib/stores/known-workspaces';
import { useWorkspaceDialogs } from '@/lib/stores/workspace-dialogs';

export type WorkspaceAction = { id: string; label: string; icon: LucideIcon; run: () => void };

/**
 * The open workspace, the others to switch to, and what can be done about
 * them: the sidebar's switcher and the phone's workspace sheet.
 */
export function useWorkspaceChoices() {
  const activePath = useWorkspace((s) => s.path);
  const setWorkspace = useWorkspace((s) => s.setWorkspace);
  const openFolder = useWorkspace((s) => s.openFolder);
  const workspaces = useKnownWorkspaces((s) => s.workspaces);
  const showDialog = useWorkspaceDialogs((s) => s.show);

  const active = workspaces.find((w) => w.path === activePath);
  const activeName = active?.name ?? (activePath ? activePath.split(/[\\/]/).pop()! : null);

  const actions: WorkspaceAction[] = [
    { id: 'new', label: 'New workspace…', icon: Plus, run: () => showDialog('new') },
    // On the web, workspaces are the vaults on the server.
    ...(can.localFolders
      ? [{ id: 'import', label: 'Import from sync…', icon: CloudDownload, run: () => showDialog('import') }]
      : []),
    ...(can.pickFolders
      ? [{ id: 'open', label: 'Open folder as workspace…', icon: FolderOpen, run: () => void openFolder() }]
      : []),
  ];
  const manage: WorkspaceAction = {
    id: 'manage',
    label: 'Manage workspaces…',
    icon: Settings2,
    run: () => showDialog('manage'),
  };

  return { activePath, activeName, workspaces, switchTo: setWorkspace, actions, manage };
}
