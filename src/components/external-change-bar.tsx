import { FileWarning, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';

type ExternalChangeBarProps = {
  variant: 'conflict' | 'deleted';
  onReload: () => void;
  onKeepMine: () => void;
  onClose: () => void;
};

/**
 * Shown when the file behind an editor changed on disk while the buffer held
 * unsaved edits, so neither version can be discarded silently.
 *
 * Rendered inside the editor's own scroll container, hence `sticky`.
 */
export function ExternalChangeBar({
  variant,
  onReload,
  onKeepMine,
  onClose,
}: ExternalChangeBarProps) {
  const deleted = variant === 'deleted';
  const Icon = deleted ? Trash2 : FileWarning;

  return (
    <div className='sticky top-0 z-20 flex flex-wrap items-center gap-2 border-b border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm'>
      <Icon className='size-4 shrink-0 text-amber-600 dark:text-amber-400' />

      <span className='min-w-0 flex-1'>
        {deleted
          ? 'This file was deleted on disk. Your unsaved changes are still here.'
          : 'This file changed on disk, and you have unsaved changes.'}
      </span>

      {!deleted && (
        <Button size='sm' variant='outline' onClick={onReload}>
          Reload from disk
        </Button>
      )}

      <Button size='sm' variant='outline' onClick={onKeepMine}>
        {deleted ? 'Save it back' : 'Keep mine'}
      </Button>

      {deleted && (
        <Button size='sm' variant='ghost' onClick={onClose}>
          Close tab
        </Button>
      )}
    </div>
  );
}
