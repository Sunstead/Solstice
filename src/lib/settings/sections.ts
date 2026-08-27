import { Files, Keyboard, PenLine, Paintbrush, type LucideIcon } from 'lucide-react';

/**
 * The nav down the left of the settings dialog. Deliberately shaped like
 * `primaryViews` in `@/lib/views/registry` -- plain data, no React, so the
 * settings registry can type-reference `SectionId` without pulling components
 * into the data layer. Custom (non-generated) panes are wired separately in
 * `@/components/settings/panes`.
 */
export interface SettingsSection {
  id: string;
  label: string;
  icon: LucideIcon;
}

export const settingsSections = [
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
] as const satisfies readonly SettingsSection[];

export type SectionId = (typeof settingsSections)[number]['id'];

export function getSection(id: SectionId): SettingsSection {
  return settingsSections.find((s) => s.id === id)!;
}
