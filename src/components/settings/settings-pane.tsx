import { Separator } from '@/components/ui/separator';
import { settingsForSection, type SettingKey } from '@/lib/settings/registry';
import type { SectionId } from '@/lib/settings/sections';
import { useSettingReader } from '@/lib/settings/store';
import type { AnySettingDef } from '@/lib/settings/types';
import { SettingRow } from './setting-row';

/**
 * The default pane: every setting declared for this section, in registry
 * order, split under its `group` heading. A new setting appears here with no
 * UI work at all -- which is the point of the registry.
 */
export function SettingsPane({ section }: { section: SectionId }) {
  const read = useSettingReader();

  const visible = settingsForSection(section).filter(([, def]) => {
    const { visibleWhen } = def as AnySettingDef;
    return visibleWhen ? visibleWhen(read) : true;
  });

  if (visible.length === 0) {
    return (
      <p className='py-8 text-sm text-muted-foreground'>
        Nothing to configure here yet.
      </p>
    );
  }

  // Preserve declaration order for both the groups and the rows inside them.
  const groups: { name: string | undefined; keys: SettingKey[] }[] = [];
  for (const [key, def] of visible) {
    const name = (def as AnySettingDef).group;
    const last = groups[groups.length - 1];
    if (last && last.name === name) last.keys.push(key);
    else groups.push({ name, keys: [key] });
  }

  return (
    <div className='flex flex-col'>
      {groups.map((group, index) => (
        <section key={group.name ?? `__ungrouped-${index}`}>
          {group.name && (
            <h3 className='pt-6 pb-1 text-xs font-medium text-muted-foreground'>
              {group.name}
            </h3>
          )}
          <div className='divide-y divide-border/60'>
            {group.keys.map((key) => (
              <SettingRow key={key} settingKey={key} />
            ))}
          </div>
          {index < groups.length - 1 && !groups[index + 1].name && (
            <Separator className='my-2' />
          )}
        </section>
      ))}
    </div>
  );
}
