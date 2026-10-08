import type * as React from 'react';
import type { SectionId } from '@/lib/settings/sections';
import { KeybindingsPane } from './keybindings-pane';
import { can } from '@/lib/backend/platform';
import { SyncPane } from './sync-pane';
import { ThemePane } from './theme-pane';
import { TypographyPane } from './typography-pane';
import { WebAccountPane } from './web-account-pane';

/**
 * Sections that are not a list of generated rows. Anything absent here falls
 * back to `SettingsPane`. Kept out of `lib/settings/sections.ts` so the data
 * layer stays free of React imports.
 */
export const customPanes: Partial<Record<SectionId, React.ComponentType>> = {
  appearance: ThemePane,
  typography: TypographyPane,
  keybindings: KeybindingsPane,
  // In the browser the app is the server: the account, not a link.
  sync: can.syncSettings ? SyncPane : WebAccountPane,
};
