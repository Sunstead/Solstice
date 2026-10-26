import { PencilLine, PencilRuler } from 'lucide-react';

import { Button } from '@sunstead/ui/components/button';
import { setSetting, useSetting } from '@/lib/settings/store';
import { phoneInk } from '@/lib/stores/ink-tools';

/**
 * Shows or hides the ink tools under the header (`ink.ribbon`), for every
 * file. On an iPhone it's drawing itself, on or off (`phoneInk`).
 */
export function RibbonToggle({ className }: { className?: string }) {
  const shown = useSetting('ink.ribbon');
  const label = phoneInk ? (shown ? 'Stop Drawing' : 'Draw') : shown ? 'Hide Tools' : 'Show Tools';
  const Icon = phoneInk ? PencilLine : PencilRuler;
  return (
    <Button
      variant={shown ? 'secondary' : 'ghost'}
      size='icon-sm'
      className={className}
      aria-pressed={shown}
      title={label}
      onClick={() => setSetting('ink.ribbon', !shown)}
    >
      <Icon />
      <span className='sr-only'>{label}</span>
    </Button>
  );
}
