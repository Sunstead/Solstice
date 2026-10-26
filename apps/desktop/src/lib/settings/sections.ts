import {
  CircleUser,
  Info,
  Files,
  RefreshCw,
  Keyboard,
  PenLine,
  Palette,
  Type,
  type LucideIcon,
  PersonStanding,
} from 'lucide-react';
import { inTauri } from '@/lib/backend';
import { can } from '@/lib/backend/platform';

/**
 * The nav down the left of the settings dialog, shaped like `primaryViews` in
 * `@/lib/views/registry`. Plain data with no React, so the settings registry
 * can reference `SectionId` without pulling components into the data layer;
 * custom (non-generated) panes are wired in `@/components/settings/panes`.
 */
export interface SettingsSection {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Takes the dialog's full width on a computer; the rest sit in a centred column. */
  wide?: boolean;
}

export const settingsSections = [
  // Themes and the leftover visual toggles (viewers, canvas) live under one
  // "Appearance" section; typography stays separate since it is comprehensive
  // enough to deserve its own nav item.
  {
    id: 'appearance',
    label: 'Appearance',
    icon: Palette,
  },
  {
    id: 'typography',
    label: 'Typography',
    icon: Type,
    // The live preview sits beside the settings.
    wide: true,
  },
  {
    id: 'editor',
    label: 'Editor',
    icon: PenLine,
  },
  {
    id: 'explorer',
    label: 'Explorer',
    icon: Files,
  },
  {
    id: 'sync',
    // The web app is the server, so there's only the account to show.
    label: can.syncSettings ? 'Sync' : 'Account',
    icon: can.syncSettings ? RefreshCw : CircleUser,
  },
  {
    id: 'keybindings',
    label: 'Keyboard',
    icon: Keyboard,
  },
  {
    id: 'accessibility',
    label: 'Accessibility',
    icon: PersonStanding
  },
  // The app's version, and its updates on a computer. The web app's version
  // is its server's.
  ...(inTauri ? [{ id: 'about', label: 'About', icon: Info }] as const : []),
] as const satisfies readonly SettingsSection[];

export type SectionId = (typeof settingsSections)[number]['id'];

/**
 * The sections a touch phone leaves out: shortcuts are for a hardware
 * keyboard, which an iPhone almost never has, and their table needs a
 * wider screen than a phone's.
 */
const NOT_ON_PHONE: readonly SectionId[] = ['keybindings'];

export function shownOnPhone(id: SectionId): boolean {
  return !NOT_ON_PHONE.includes(id);
}

export function getSection(id: SectionId): SettingsSection {
  return settingsSections.find((s) => s.id === id)!;
}
