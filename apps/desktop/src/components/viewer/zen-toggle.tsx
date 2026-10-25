import { Maximize2, Minimize2 } from 'lucide-react';

import { Button } from '@sunstead/ui/components/button';
import { toggleZen, useZen, useZenAllowed } from '@/lib/zen';

/** Zen mode's header toggle; nothing where Zen isn't offered. */
export function ZenToggle() {
  const allowed = useZenAllowed();
  const zen = useZen();
  if (!allowed) return null;
  const label = zen ? 'Exit Zen Mode' : 'Zen Mode';
  return (
    <Button variant={zen ? 'secondary' : 'ghost'} size='icon-sm' aria-pressed={zen} title={label} onClick={toggleZen}>
      {zen ? <Minimize2 /> : <Maximize2 />}
      <span className='sr-only'>{label}</span>
    </Button>
  );
}
