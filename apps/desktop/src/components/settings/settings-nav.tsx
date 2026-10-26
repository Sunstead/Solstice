import { Row } from '@/components/mobile/phone-parts';
import { useIsMobile } from '@sunstead/ui/hooks/use-mobile';
import { touchFirst } from '@/lib/backend/platform';
import { settingsSections, shownOnPhone, type SectionId } from '@/lib/settings/sections';
import { customPanes } from './panes';
import { SettingsPane } from './settings-pane';

/**
 * Settings as a list of sections, each opening a page of its own: the
 * phone's You page and the touch dialog (Discord's and Goodnotes' way).
 */
export function SettingsSectionList({ onOpen }: { onOpen: (id: SectionId) => void }) {
  const phone = useIsMobile() && touchFirst;
  const sections = phone ? settingsSections.filter((section) => shownOnPhone(section.id)) : settingsSections;
  return (
    <div className='phone-rows flex flex-col overflow-hidden rounded-xl bg-card'>
      {sections.map((section) => (
        <Row key={section.id} icon={section.icon} label={section.label} chevron onClick={() => onOpen(section.id)} />
      ))}
    </div>
  );
}

/** A section's settings: its own pane, or the rows the registry generates. */
export function SettingsSectionBody({ id }: { id: SectionId }) {
  const Custom = customPanes[id];
  return Custom ? <Custom /> : <SettingsPane section={id} />;
}
