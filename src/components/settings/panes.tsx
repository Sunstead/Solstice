import type * as React from 'react';
import type { SectionId } from '@/lib/settings/sections';
import { KeybindingsPane } from './keybindings-pane';

/**
 * The escape hatch for sections that are not a list of generated rows.
 * Anything absent here falls back to `SettingsPane`, which renders the
 * registry. Kept out of `lib/settings/sections.ts` so the data layer stays
 * free of React imports.
 */
export const customPanes: Partial<Record<SectionId, React.ComponentType>> = {
  keybindings: KeybindingsPane,
};
