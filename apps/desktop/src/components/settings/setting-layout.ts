import type { AnySettingDef } from '@/lib/settings/types';

export function isWideControl(def: AnySettingDef) {
  return def.kind === 'enum';
}

/** Controls too wide to share a phone-width row with their label. */
export function stacksOnPhone(def: AnySettingDef) {
  return (
    def.kind === 'text' ||
    def.kind === 'select' ||
    def.kind === 'font' ||
    (def.kind === 'number' && def.control === 'slider')
  );
}
