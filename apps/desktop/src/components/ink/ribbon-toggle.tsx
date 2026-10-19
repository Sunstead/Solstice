import { PencilRuler } from 'lucide-react';

import { Button } from '@sunstead/ui/components/button';
import { setSetting, useSetting } from '@/lib/settings/store';

/** Shows or hides the ink tools under the header (`ink.ribbon`), for every file. */
export function RibbonToggle() {
  const shown = useSetting('ink.ribbon');
  const label = shown ? 'Hide Tools' : 'Show Tools';
  return (
    <Button
      variant={shown ? 'secondary' : 'ghost'}
      size='icon-sm'
      aria-pressed={shown}
      title={label}
      onClick={() => setSetting('ink.ribbon', !shown)}
    >
      <PencilRuler />
      <span className='sr-only'>{label}</span>
    </Button>
  );
}
