import { create } from 'zustand';
import { FileTreeNode } from '@/hooks/use-files';

type FileActionDialogState = {
  deleteTarget: FileTreeNode | null;
  moveTarget: FileTreeNode | null;
  requestDelete: (node: FileTreeNode) => void;
  requestMove: (node: FileTreeNode) => void;
  closeDelete: () => void;
  closeMove: () => void;
};

/**
 * Tracks which file/folder (if any) the delete-confirmation or
 * move-to-folder dialog is currently acting on. Centralized here — rather
 * than local state per tree row — so a single, app-wide dialog instance can
 * be rendered instead of one per row. See `FileActionDialogs` for why that
 * matters: rendering these dialogs *inside* a `ContextMenu` causes a
 * right-click inside the (portaled) dialog to bubble back up through the
 * React tree and reopen the context menu.
 */
export const useFileActionDialog = create<FileActionDialogState>((set) => ({
  deleteTarget: null,
  moveTarget: null,
  requestDelete: (node) => set({ deleteTarget: node }),
  requestMove: (node) => set({ moveTarget: node }),
  closeDelete: () => set({ deleteTarget: null }),
  closeMove: () => set({ moveTarget: null }),
}));