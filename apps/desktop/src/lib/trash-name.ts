import type { Platform } from '@/hooks/use-platform';
import type { shell as Shell } from '@/lib/backend/platform';

/**
 * Where a deleted file goes, named as the user will go looking for it if
 * they change their mind. A phone's trash is the workspace's own.
 */
export function trashName(shell: typeof Shell, platform: Platform | null): string {
  if (shell === 'mobile') return "workspace's trash";
  if (shell === 'web') return 'trash';
  if (platform === 'macos') return 'system trash';
  if (platform === 'windows') return 'Recycle Bin';
  if (platform === 'linux') return 'Trash';
  return 'trash';
}
