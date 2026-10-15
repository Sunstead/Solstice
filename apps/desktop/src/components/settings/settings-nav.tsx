import { Row } from '@/components/mobile/phone-parts';
import { settingsSections, type SectionId } from '@/lib/settings/sections';
import { customPanes } from './panes';
import { SettingsPane } from './settings-pane';

/**
 * Settings as a list of sections, each opening a page of its own: the
 * phone's You page and the touch dialog (Discord's and Goodnotes' way).
 */
export function SettingsSectionList({ onOpen }: { onOpen: (id: SectionId) => void }) {
  return (
    <div className='flex flex-col divide-y overflow-hidden rounded-xl border bg-card'>
      {settingsSections.map((section) => (
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
