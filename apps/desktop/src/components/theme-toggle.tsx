import { Moon, Sun } from 'lucide-react';

import { Button } from '@sunstead/ui/components/button';
import { useTheme } from '@/hooks/use-theme';

/**
 * The quick flip in the sidebar rail. Deliberately binary -- it toggles away
 * from whatever is currently on screen, so it works from `system` mode too,
 * landing on the last theme used in the other appearance. Choosing among the
 * presets themselves lives in Settings > Theme.
 */
export function ThemeToggle() {
  const { toggleAppearance } = useTheme();

  return (
    <Button
      variant='ghost'
      size='icon'
      onClick={toggleAppearance}
      className='size-10'
    >
      <Sun className='size-5 scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90' />
      <Moon className='absolute size-5 scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0' />
      <span className='sr-only'>Toggle theme</span>
    </Button>
  );
}
