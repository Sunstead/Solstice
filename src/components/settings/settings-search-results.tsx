import { searchSettings } from '@/lib/settings/search';
import { getSection, type SectionId } from '@/lib/settings/sections';
import { useSettingReader } from '@/lib/settings/store';
import { useSettingsDialog } from '@/lib/stores/settings-dialog';
import { SettingList } from './setting-list';

/**
 * Results across every section, so a setting can be found without knowing which
 * pane holds it. Each group keeps its section heading, which is what tells you
 * where the setting lives once you have found it.
 */
export function SettingsSearchResults({ query }: { query: string }) {
  const read = useSettingReader();
  const setActiveSection = useSettingsDialog((s) => s.setActiveSection);
  const { sections, groups, total } = searchSettings(query, read);

  if (total === 0 && sections.length === 0) {
    return (
      <p className='py-10 text-center text-sm text-muted-foreground'>
        No settings match “{query}”.
      </p>
    );
  }

  return (
    <div className='flex flex-col'>
      {sections.length > 0 && (
        <section>
          <h3 className='pt-2 pb-1 text-xs font-medium text-muted-foreground'>
            Sections
          </h3>
          <div className='flex flex-wrap gap-1.5 pb-2'>
            {sections.map((id: SectionId) => {
              const section = getSection(id);
              return (
                <button
                  key={id}
                  type='button'
                  onClick={() => setActiveSection(id)}
                  className='flex items-center gap-1.5 rounded-md bg-foreground/8 px-2.5 py-1.5 text-sm select-none hover:bg-foreground/12'
                >
                  <section.icon className='size-4' />
                  {section.label}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {groups.map((group) => (
        <section key={group.section}>
          <h3 className='pt-4 pb-1 text-xs font-medium text-muted-foreground'>
            {getSection(group.section).label}
          </h3>
          <SettingList keys={group.keys} />
        </section>
      ))}
    </div>
  );
}
