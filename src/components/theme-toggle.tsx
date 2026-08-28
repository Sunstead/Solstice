import { Moon, Sun } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { resolvedTheme, useTheme } from '@/hooks/use-theme';

/**
 * The quick flip in the sidebar rail. Deliberately binary -- it toggles away
 * from whatever is currently on screen, so it works from `system` too. The
 * three-way choice lives in Settings > Appearance.
 */
export function ThemeToggle() {
  const { setTheme } = useTheme();

  return (
    <Button
      variant='ghost'
      size='icon'
      onClick={() => setTheme(resolvedTheme() === 'dark' ? 'light' : 'dark')}
      className='size-10'
    >
      <Sun className='size-5 scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90' />
      <Moon className='absolute size-5 scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0' />
      <span className='sr-only'>Toggle theme</span>
    </Button>
  );
}
