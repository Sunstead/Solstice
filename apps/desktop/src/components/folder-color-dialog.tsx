import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getFileNameFromPath } from '@/lib/path-utils';
import { useFolderColorDialog } from '@/lib/stores/folder-color-dialog';
import { useTreeMeta } from '@/lib/stores/tree-meta';
import { FOLDER_COLORS } from '@/lib/tree-meta/colors';
import { ColorPickerPanel } from './color-picker-panel';

const SWATCHES = FOLDER_COLORS.map((c) => c.hex);

/**
 * A folder's colour, picked by hand: the presets and any hex. A dialog
 * rather than a popover, since the menu that opened it has gone (and on a
 * touch screen a dialog is a pane).
 */
export function FolderColorDialog() {
  const path = useFolderColorDialog((s) => s.path);
  const close = useFolderColorDialog((s) => s.close);
  const color = useTreeMeta((s) => (path ? s.folderColor(path) : null));

  return (
    <Dialog open={path !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent className='sm:max-w-xs'>
        <DialogHeader>
          <DialogTitle>{path ? `Colour for ${getFileNameFromPath(path)}` : 'Folder colour'}</DialogTitle>
        </DialogHeader>
        {path && (
          <ColorPickerPanel
            key={path}
            color={color}
            swatches={SWATCHES}
            onChoose={(next) => useTreeMeta.getState().setFolderColor(path, next)}
            reset={{ title: 'No colour', enabled: color !== null }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
