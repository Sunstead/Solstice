// Neo-brutalist, inverted: a raw near-black slab instead of white paper, but
// the same formula -- full-opacity white rule lines instead of a tint, zero
// radius, and one flat poster-yellow primary with the hot-pink accent from
// Brutalist carried over so the pair reads as one family, day and night.
import type { Theme } from '../types';

export const concrete: Theme = {
  id: 'concrete',
  name: 'Concrete',
  appearance: 'dark',
  vars: {
    '--background': 'oklch(0.16 0 0)',
    '--foreground': 'oklch(0.97 0 0)',
    '--card': 'oklch(0.2 0 0)',
    '--card-foreground': 'oklch(0.97 0 0)',
    '--popover': 'oklch(0.2 0 0)',
    '--popover-foreground': 'oklch(0.97 0 0)',
    '--primary': 'oklch(0.85 0.19 96)',
    '--primary-foreground': 'oklch(0.145 0 0)',
    '--secondary': 'oklch(0.97 0 0)',
    '--secondary-foreground': 'oklch(0.145 0 0)',
    '--muted': 'oklch(0.26 0 0)',
    '--muted-foreground': 'oklch(0.72 0 0)',
    '--accent': 'oklch(0.72 0.24 340)',
    '--accent-foreground': 'oklch(0.145 0 0)',
    '--destructive': 'oklch(0.66 0.23 25)',
    '--warning': 'oklch(0.8 0.16 75)',
    // Full-strength white at full opacity: the line is the material here, not
    // a tint of it, same as the light version's black rules.
    '--border-color': 'oklch(1 0 0)',
    '--border-opacity': '100%',
    '--input': 'oklch(1 0 0)',
    '--ring': 'oklch(1 0 0)',
    '--chart-1': 'oklch(0.85 0.19 96)',
    '--chart-2': 'oklch(0.72 0.24 340)',
    '--chart-3': 'oklch(0.7 0.18 255)',
    '--chart-4': 'oklch(0.78 0.19 150)',
    '--chart-5': 'oklch(0.66 0.23 25)',
    '--sidebar': 'oklch(0.13 0 0)',
    '--sidebar-foreground': 'oklch(0.97 0 0)',
    '--sidebar-primary': 'oklch(0.97 0 0)',
    '--sidebar-primary-foreground': 'oklch(0.145 0 0)',
    '--sidebar-accent': 'oklch(0.85 0.19 96)',
    '--sidebar-accent-foreground': 'oklch(0.145 0 0)',
    '--sidebar-border': 'oklch(1 0 0)',
    '--sidebar-ring': 'oklch(1 0 0)',
    '--syntax-keyword': 'oklch(0.7 0.18 255)',
    '--syntax-string': 'oklch(0.78 0.19 150)',
    '--syntax-number': 'oklch(0.72 0.24 340)',
    '--syntax-function': 'oklch(0.97 0 0)',
    '--syntax-type': 'oklch(0.75 0.16 255)',
    '--syntax-property': 'oklch(0.75 0.02 0)',
    '--syntax-constant': 'oklch(0.66 0.23 25)',
    '--syntax-tag': 'oklch(0.72 0.24 340)',
    '--canvas-color-1': 'oklch(0.66 0.23 25)',
    '--canvas-color-2': 'oklch(0.85 0.19 96)',
    '--canvas-color-3': 'oklch(0.78 0.19 150)',
    '--canvas-color-4': 'oklch(0.7 0.18 255)',
    '--canvas-color-5': 'oklch(0.72 0.24 340)',
    '--canvas-color-6': 'oklch(0.97 0 0)',
    // Sharp corners, full stop -- same as the light version.
    '--radius': '0rem',
  },
};
