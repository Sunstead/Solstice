import {
  settingKeys,
  settingsRegistry,
  type SettingKey,
} from './registry';
import { settingsSections, type SectionId } from './sections';
import type { AnySettingDef, SettingReader } from './types';

/** Everything about a setting worth matching a query against. */
function haystack(key: SettingKey): string {
  const def = settingsRegistry[key] as AnySettingDef;
  const parts: string[] = [
    def.label,
    key,
    def.group ?? '',
    settingsSections.find((s) => s.id === def.section)?.label ?? '',
  ];

  if (def.kind === 'enum') {
    for (const option of def.options) parts.push(option.label);
  }
  if (def.kind === 'number' && def.unit) parts.push(def.unit);

  return parts.join(' ').toLowerCase();
}

// Built once: the registry is static, and this runs on every keystroke.
const haystacks = new Map<SettingKey, string>(
  settingKeys.map((key) => [key, haystack(key)]),
);

function terms(query: string) {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/** Every term must appear somewhere, so extra words narrow rather than widen. */
function matches(text: string, queryTerms: string[]) {
  return queryTerms.every((term) => text.includes(term));
}

export interface SettingsSearchResults {
  /** Sections whose own name matched; offered as a jump rather than a row. */
  sections: SectionId[];
  /** Matching settings, grouped by section, both in registry order. */
  groups: { section: SectionId; keys: SettingKey[] }[];
  total: number;
}

/**
 * Search every section at once, so a setting can be found without knowing
 * which pane it lives in.
 *
 * `isVisible` skips settings whose `visibleWhen` currently fails -- surfacing
 * a row that the pane itself would hide would offer a control that cannot
 * meaningfully be used.
 */
export function searchSettings(
  query: string,
  read: SettingReader,
): SettingsSearchResults {
  const queryTerms = terms(query);
  if (queryTerms.length === 0) {
    return { sections: [], groups: [], total: 0 };
  }

  const bySection = new Map<SectionId, SettingKey[]>();
  let total = 0;

  for (const key of settingKeys) {
    const def = settingsRegistry[key] as AnySettingDef;
    if (def.visibleWhen && !def.visibleWhen(read)) continue;
    if (!matches(haystacks.get(key)!, queryTerms)) continue;

    const section = def.section as SectionId;
    const existing = bySection.get(section);
    if (existing) existing.push(key);
    else bySection.set(section, [key]);
    total += 1;
  }

  // Section order follows the nav, not insertion order.
  const groups = settingsSections
    .filter((section) => bySection.has(section.id))
    .map((section) => ({ section: section.id, keys: bySection.get(section.id)! }));

  const sections = settingsSections
    .filter((section) => matches(section.label.toLowerCase(), queryTerms))
    .map((section) => section.id);

  return { sections, groups, total };
}
