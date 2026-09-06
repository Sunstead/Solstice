import {
  Files,
  Keyboard,
  PenLine,
  Paintbrush,
  Palette,
  Type,
  type LucideIcon,
  PersonStanding,
} from 'lucide-react';

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
}

export const settingsSections = [
  {
    id: 'theme',
    label: 'Theme',
    icon: Palette,
  },
  {
    id: 'typography',
    label: 'Typography',
    icon: Type,
  },
  {
    id: 'appearance',
    label: 'Appearance',
    icon: Paintbrush,
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
    id: 'keybindings',
    label: 'Keyboard',
    icon: Keyboard,
  },
  {
    id: 'accessibility',
    label: 'Accessibility',
    icon: PersonStanding
  }
] as const satisfies readonly SettingsSection[];

export type SectionId = (typeof settingsSections)[number]['id'];

export function getSection(id: SectionId): SettingsSection {
  return settingsSections.find((s) => s.id === id)!;
}
