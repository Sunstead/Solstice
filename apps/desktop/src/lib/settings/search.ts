import {
  isSettingVisible,
  settingKeys,
  settingsRegistry,
  type SettingKey,
} from './registry';
import { settingsSections, type SectionId } from './sections';
import type { SettingReader } from './types';

/** Everything about a setting worth matching a query against. */
function haystack(key: SettingKey): string {
  const def = settingsRegistry[key];
  const parts: string[] = [
    def.label,
    key,
    def.group ?? '',
    settingsSections.find((s) => s.id === def.section)?.label ?? '',
  ];

  if (def.kind === 'enum') parts.push(...def.options.map((o) => o.label));
  // A dynamic option list is skipped: it is read off disk, so it is empty when
  // this table is built and would go stale the moment a theme file changed.
  if (def.kind === 'select' && Array.isArray(def.options)) {
    parts.push(...def.options.map((o) => o.label));
  }
  if (def.kind === 'font') parts.push('font family typeface');
  if (def.kind === 'number' && def.unit) parts.push(def.unit);

  return parts.join(' ').toLowerCase();
}

// Built once: the registry is static and this is read on every keystroke.
const haystacks = new Map(settingKeys.map((key) => [key, haystack(key)]));

/** Every term must appear, so extra words narrow rather than widen. */
function matches(text: string, terms: string[]) {
  return terms.every((term) => text.includes(term));
}

export interface SettingsSearchResults {
  /** Sections whose own name matched, offered as a jump rather than a row. */
  sections: SectionId[];
  /** Matching settings grouped by section, both in registry order. */
  groups: { section: SectionId; keys: SettingKey[] }[];
  total: number;
}

/**
 * Search every section at once, so a setting can be found without knowing which
 * pane it lives in. Settings currently hidden by `visibleWhen` are skipped:
 * surfacing a row the pane itself would hide offers a control that cannot
 * meaningfully be used.
 */
export function searchSettings(
  query: string,
  read: SettingReader,
): SettingsSearchResults {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return { sections: [], groups: [], total: 0 };

  const bySection = new Map<SectionId, SettingKey[]>();
  let total = 0;

  for (const key of settingKeys) {
    const def = settingsRegistry[key];
    if (!isSettingVisible(def, read)) continue;
    if (!matches(haystacks.get(key)!, terms)) continue;

    const section = def.section;
    bySection.set(section, [...(bySection.get(section) ?? []), key]);
    total += 1;
  }

  // Groups and section jumps both follow nav order, not match order.
  return {
    sections: settingsSections
      .filter((section) => matches(section.label.toLowerCase(), terms))
      .map((section) => section.id),
    groups: settingsSections
      .filter((section) => bySection.has(section.id))
      .map((section) => ({
        section: section.id,
        keys: bySection.get(section.id)!,
      })),
    total,
  };
}
