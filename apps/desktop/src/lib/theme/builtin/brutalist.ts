// Neo-brutalist: stark white, ink-black borders at full opacity, one flat
// poster-yellow accent, and zero radius everywhere. No soft edges and no
// gradients-by-proxy (chroma is otherwise low) -- the yellow is the only loud
// thing in the room, which is the point.
import type { Theme } from '../types';

export const brutalist: Theme = {
  id: 'brutalist',
  name: 'Brutalist',
  appearance: 'light',
  vars: {
    '--background': 'oklch(1 0 0)',
    '--foreground': 'oklch(0.145 0 0)',
    '--card': 'oklch(1 0 0)',
    '--card-foreground': 'oklch(0.145 0 0)',
    '--popover': 'oklch(1 0 0)',
    '--popover-foreground': 'oklch(0.145 0 0)',
    '--primary': 'oklch(0.85 0.19 96)',
    '--primary-foreground': 'oklch(0.145 0 0)',
    '--secondary': 'oklch(0.145 0 0)',
    '--secondary-foreground': 'oklch(1 0 0)',
    '--muted': 'oklch(0.94 0 0)',
    '--muted-foreground': 'oklch(0.32 0 0)',
    '--accent': 'oklch(0.72 0.24 340)',
    '--accent-foreground': 'oklch(0.145 0 0)',
    '--destructive': 'oklch(0.58 0.24 25)',
    '--warning': 'oklch(0.78 0.17 75)',
    // Full-strength black at full opacity: a brutalist border is a line, not a
    // tint, on both light and hovered surfaces.
    '--border-color': 'oklch(0.145 0 0)',
    '--border-opacity': '100%',
    '--input': 'oklch(0.145 0 0)',
    '--ring': 'oklch(0.145 0 0)',
    '--chart-1': 'oklch(0.85 0.19 96)',
    '--chart-2': 'oklch(0.72 0.24 340)',
    '--chart-3': 'oklch(0.62 0.22 255)',
    '--chart-4': 'oklch(0.7 0.19 150)',
    '--chart-5': 'oklch(0.58 0.24 25)',
    '--sidebar': 'oklch(1 0 0)',
    '--sidebar-foreground': 'oklch(0.145 0 0)',
    '--sidebar-primary': 'oklch(0.145 0 0)',
    '--sidebar-primary-foreground': 'oklch(1 0 0)',
    '--sidebar-accent': 'oklch(0.85 0.19 96)',
    '--sidebar-accent-foreground': 'oklch(0.145 0 0)',
    '--sidebar-border': 'oklch(0.145 0 0)',
    '--sidebar-ring': 'oklch(0.145 0 0)',
    '--syntax-keyword': 'oklch(0.62 0.22 255)',
    '--syntax-string': 'oklch(0.6 0.19 150)',
    '--syntax-number': 'oklch(0.72 0.24 340)',
    '--syntax-function': 'oklch(0.145 0 0)',
    '--syntax-type': 'oklch(0.55 0.2 255)',
    '--syntax-property': 'oklch(0.5 0.02 0)',
    '--syntax-constant': 'oklch(0.58 0.24 25)',
    '--syntax-tag': 'oklch(0.72 0.24 340)',
    '--canvas-color-1': 'oklch(0.58 0.24 25)',
    '--canvas-color-2': 'oklch(0.85 0.19 96)',
    '--canvas-color-3': 'oklch(0.7 0.19 150)',
    '--canvas-color-4': 'oklch(0.62 0.22 255)',
    '--canvas-color-5': 'oklch(0.72 0.24 340)',
    '--canvas-color-6': 'oklch(0.145 0 0)',
    // Sharp corners, full stop.
    '--radius': '0rem',
  },
};
