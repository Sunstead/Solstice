import type { SettingKey } from '@/lib/settings/registry';
import { SettingRow } from './setting-row';

/** A run of setting rows with separators, shared by the panes and search results. */
export function SettingList({ keys }: { keys: SettingKey[] }) {
  return (
    <div className='divide-y divide-border/60'>
      {keys.map((key) => (
        <SettingRow key={key} settingKey={key} />
      ))}
    </div>
  );
}
