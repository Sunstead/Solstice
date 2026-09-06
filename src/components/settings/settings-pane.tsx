import {
  visibleSettingsForSection,
  type SettingKey,
} from '@/lib/settings/registry';
import type { SectionId } from '@/lib/settings/sections';
import { useSettingReader } from '@/lib/settings/store';
import { SettingList } from './setting-list';

interface Group {
  name: string | undefined;
  keys: SettingKey[];
}

/** Consecutive settings sharing a `group` render under one heading. */
function groupByHeading(entries: { key: SettingKey; def: { group?: string } }[]) {
  const groups: Group[] = [];
  for (const { key, def } of entries) {
    const last = groups[groups.length - 1];
    if (last && last.name === def.group) last.keys.push(key);
    else groups.push({ name: def.group, keys: [key] });
  }
  return groups;
}

/**
 * The default pane: every visible setting declared for this section, in
 * registry order. A new setting appears here with no UI work at all.
 *
 * `excludeKeys` lets a custom pane borrow the rest of its own section's
 * generated rows without duplicating the ones it renders its own control for
 * -- the theme pane's preset picker is a grid, not a row, but "File viewers"
 * and "Canvas" still belong to it as ordinary settings.
 */
export function SettingsPane({
  section,
  excludeKeys,
}: {
  section: SectionId;
  excludeKeys?: readonly SettingKey[];
}) {
  const read = useSettingReader();
  const entries = visibleSettingsForSection(section, read).filter(
    ({ key }) => !excludeKeys?.includes(key),
  );

  if (entries.length === 0) {
    return (
      <p className='py-8 text-sm text-muted-foreground'>
        Nothing to configure here yet.
      </p>
    );
  }

  return (
    <div className='flex flex-col gap-7'>
      {groupByHeading(entries).map((group, index) => (
        <section key={group.name ?? `ungrouped-${index}`}>
          {group.name && (
            <h3 className='pt-0 pb-1 text-xs font-medium text-muted-foreground'>
              {group.name}
            </h3>
          )}
          <SettingList keys={group.keys} />
        </section>
      ))}
    </div>
  );
}
