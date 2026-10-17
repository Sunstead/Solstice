import { Moon, Sun } from 'lucide-react';

import { Button } from '@sunstead/ui/components/button';
import { setSetting, useSetting } from '@/lib/settings/store';

/**
 * Dark paper (`ink.darkPaper`) for drawings, notebooks and PDFs: the page
 * goes dark and the ink's lightness swaps to stay readable. Only how it's
 * shown; the file keeps its colours. One setting for every file.
 */
export function PaperToggle() {
  const dark = useSetting('ink.darkPaper');
  const label = dark ? 'Light Paper' : 'Dark Paper';
  return (
    <Button
      variant={dark ? 'secondary' : 'ghost'}
      size='icon-sm'
      aria-pressed={dark}
      title={label}
      onClick={() => setSetting('ink.darkPaper', !dark)}
    >
      {dark ? <Sun /> : <Moon />}
      <span className='sr-only'>{label}</span>
    </Button>
  );
}
