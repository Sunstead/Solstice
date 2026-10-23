import { getFolderIcon } from '@/assets/icons';
import { cn } from '@/lib/utils';

const Closed = getFolderIcon(false);
const Open = getFolderIcon(true);

/**
 * A folder's icon in its color (`useTreeMeta`'s `folderColor`), or the
 * default yellow without one. Both folder SVGs paint one fill, so the
 * color replaces it (`.folder-tint` in `styles/app.css`).
 */
export function FolderGlyph({
  open = false,
  color,
  className,
}: {
  open?: boolean;
  color: string | null;
  className?: string;
}) {
  const props = {
    className: cn(color && 'folder-tint', className),
    style: color ? ({ '--folder-tint': color } as React.CSSProperties) : undefined,
  };
  return open ? <Open {...props} /> : <Closed {...props} />;
}
