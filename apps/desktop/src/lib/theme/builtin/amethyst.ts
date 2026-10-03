// Dark, purple and rounded, but restrained rather than playful: the neutrals
// carry only a whisper of violet, one accent does the color work, and the
// syntax ramp stays close to that same hue family instead of spreading across
// the wheel. --radius is generous without going as far as Bubblegum's --
// rounded enough to read as soft, not enough to read as a toy.
import type { Theme } from '../types';

export const amethyst: Theme = {
  id: 'amethyst',
  name: 'Amethyst',
  appearance: 'dark',
  vars: {
    '--background': 'oklch(0.192 0.015 300)',
    '--foreground': 'oklch(0.925 0.01 300)',
    '--card': 'oklch(0.228 0.018 300)',
    '--card-foreground': 'oklch(0.935 0.01 300)',
    '--popover': 'oklch(0.248 0.02 300)',
    '--popover-foreground': 'oklch(0.94 0.01 300)',
    '--primary': 'oklch(0.565 0.2 300)',
    '--primary-foreground': 'oklch(0.975 0.008 300)',
    '--secondary': 'oklch(0.284 0.022 300)',
    '--secondary-foreground': 'oklch(0.93 0.008 300)',
    '--muted': 'oklch(0.264 0.018 300)',
    '--muted-foreground': 'oklch(0.65 0.02 300)',
    '--accent': 'oklch(0.31 0.028 300)',
    '--accent-foreground': 'oklch(0.95 0.01 300)',
    '--destructive': 'oklch(0.645 0.21 25)',
    '--warning': 'oklch(0.78 0.15 75)',
    '--border-color': 'oklch(1 0 0)',
    '--border-opacity': '11%',
    '--input': 'oklch(0.3 0.022 300)',
    '--ring': 'oklch(0.565 0.2 300)',
    '--chart-1': 'oklch(0.565 0.2 300)',
    '--chart-2': 'oklch(0.72 0.14 330)',
    '--chart-3': 'oklch(0.7 0.13 260)',
    '--chart-4': 'oklch(0.72 0.13 190)',
    '--chart-5': 'oklch(0.68 0 0)',
    // A shade darker than --background, matching Stone's rail-behind-pane
    // logic but tinted with the rest of the surface instead of staying grey.
    '--sidebar': 'oklch(0.165 0.013 300)',
    '--sidebar-foreground': 'oklch(0.87 0.01 300)',
    '--sidebar-primary': 'oklch(0.565 0.2 300)',
    '--sidebar-primary-foreground': 'oklch(0.975 0.008 300)',
    '--sidebar-accent': 'oklch(0.28 0.02 300)',
    '--sidebar-accent-foreground': 'oklch(0.95 0.01 300)',
    '--sidebar-border': 'oklch(1 0 0 / 8%)',
    '--sidebar-ring': 'oklch(0.565 0.2 300)',
    '--syntax-keyword': 'oklch(0.7 0.19 305)',
    '--syntax-string': 'oklch(0.72 0.14 155)',
    '--syntax-number': 'oklch(0.76 0.14 60)',
    '--syntax-function': 'oklch(0.72 0.15 260)',
    '--syntax-type': 'oklch(0.74 0.11 200)',
    '--syntax-property': 'oklch(0.72 0.15 335)',
    '--syntax-constant': 'oklch(0.75 0.14 45)',
    '--syntax-tag': 'oklch(0.68 0.19 15)',
    '--canvas-color-1': 'oklch(0.68 0.19 15)',
    '--canvas-color-2': 'oklch(0.76 0.14 60)',
    '--canvas-color-3': 'oklch(0.8 0.12 95)',
    '--canvas-color-4': 'oklch(0.72 0.14 155)',
    '--canvas-color-5': 'oklch(0.7 0.13 240)',
    '--canvas-color-6': 'oklch(0.66 0.19 305)',
    // Rounded, but a step back from Bubblegum's pill-shape extreme -- minimal
    // reads as soft corners, not as a toy.
    '--radius': '1.25rem',
  },
};
