import {
  defineBoolean,
  defineEnum,
  defineNumber,
  type AnySettingDef,
} from './types';

/**
 * Every setting in the app, declared once.
 *
 * Adding one is a single edit here: the key union, the value type, the
 * default, the persistence scope and the rendered control all follow from
 * this declaration. Nothing else needs to change unless the setting has a
 * side effect beyond a re-render or a CSS variable.
 *
 * Keys are dotted strings and are the on-disk format, matching the convention
 * already used for command ids (`command_registry.rs`) and keymap.json --
 * stable, greppable, hand-editable strings rather than generated reprs.
 */
export const settingsRegistry = {
  // -- Appearance ----------------------------------------------------
  'appearance.theme': defineEnum({
    section: 'appearance',
    scope: 'global',
    label: 'Theme',
    options: [
      { value: 'system', label: 'Match system' },
      { value: 'light', label: 'Light' },
      { value: 'dark', label: 'Dark' },
    ],
    default: 'dark',
  }),

  'appearance.reduceMotion': defineBoolean({
    section: 'appearance',
    scope: 'global',
    label: 'Reduce motion',
    default: false,
    domAttr: { name: 'data-reduce-motion', format: (v) => String(v) },
  }),

  // -- Appearance / Editor typography ---------------------------------
  'editor.fontSize': defineNumber({
    section: 'appearance',
    group: 'Editor typography',
    scope: 'workspace',
    label: 'Font size',
    default: 16,
    min: 10,
    max: 32,
    step: 1,
    unit: 'px',
    cssVar: { name: '--editor-font-size', format: (v) => `${v}px` },
  }),

  'editor.lineHeight': defineNumber({
    section: 'appearance',
    group: 'Editor typography',
    scope: 'workspace',
    label: 'Line height',
    default: 1.75,
    min: 1.2,
    max: 2.4,
    step: 0.05,
    control: 'slider',
    cssVar: { name: '--editor-line-height' },
  }),

  'editor.lineWidth': defineNumber({
    section: 'appearance',
    group: 'Editor typography',
    scope: 'workspace',
    label: 'Line length',
    default: 80,
    min: 40,
    max: 160,
    step: 4,
    unit: 'ch',
    control: 'slider',
    cssVar: { name: '--editor-measure', format: (v) => `${v}ch` },
  }),

  'editor.scrollPastEnd': defineBoolean({
    section: 'appearance',
    group: 'Editor typography',
    scope: 'workspace',
    label: 'Scroll past end',
    default: true,
    cssVar: {
      name: '--editor-pad-bottom',
      format: (v) => (v ? '10rem' : '2rem'),
    },
  }),

  // -- Editor ---------------------------------------------------------
  'editor.autosave': defineEnum({
    section: 'editor',
    group: 'Saving',
    scope: 'workspace',
    label: 'Autosave',
    options: [
      { value: 'idle', label: 'After a pause' },
      { value: 'change', label: 'On every keystroke' },
    ],
    default: 'idle',
  }),

  'editor.autosaveDelay': defineNumber({
    section: 'editor',
    group: 'Saving',
    scope: 'workspace',
    label: 'Autosave delay',
    default: 400,
    min: 100,
    max: 5000,
    step: 100,
    unit: 'ms',
    visibleWhen: (get) => get('editor.autosave') === 'idle',
  }),

  'editor.spellcheck': defineBoolean({
    section: 'editor',
    group: 'Writing',
    scope: 'global',
    label: 'Spell check',
    default: true,
    // `spellcheck` is an inherited HTML attribute, so setting it on <html>
    // reaches the contenteditable without reconfiguring the editor.
    domAttr: { name: 'spellcheck', format: (v) => String(v) },
  }),

  // -- Explorer -------------------------------------------------------
  'explorer.showHiddenFiles': defineBoolean({
    section: 'explorer',
    scope: 'workspace',
    label: 'Show hidden files',
    default: false,
  }),

  'explorer.showFileExtensions': defineBoolean({
    section: 'explorer',
    scope: 'workspace',
    label: 'Always show file extensions',
    default: false,
  }),

  'explorer.foldersFirst': defineBoolean({
    section: 'explorer',
    scope: 'workspace',
    label: 'Sort folders first',
    default: true,
  }),
} satisfies Record<string, AnySettingDef>;

export type SettingKey = keyof typeof settingsRegistry;

/**
 * The value type of a setting, taken straight off its declared default -- so
 * `SettingValue<'appearance.theme'>` is `'system' | 'light' | 'dark'`, not
 * `string`.
 */
export type SettingValue<K extends SettingKey> =
  (typeof settingsRegistry)[K]['default'];

export const settingKeys = Object.keys(settingsRegistry) as SettingKey[];

export function getSettingDef(key: SettingKey): AnySettingDef {
  return settingsRegistry[key];
}

/** Registry entries belonging to one section, in declaration order. */
export function settingsForSection(section: string) {
  return settingKeys
    .map((key) => [key, settingsRegistry[key]] as const)
    .filter(([, def]) => def.section === section);
}
