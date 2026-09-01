import type { SectionId } from './sections';
import {
  defineBoolean,
  defineEnum,
  defineNumber,
  defineText,
  type AnySettingDef,
  type SettingReader,
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
    section: 'accessibility',
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

  'editor.externalChanges': defineEnum({
    section: 'editor',
    group: 'Saving',
    scope: 'workspace',
    label: 'When a file changes on disk',
    options: [
      { value: 'reload', label: 'Reload if unedited' },
      { value: 'prompt', label: 'Always ask' },
    ],
    default: 'reload',
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

  'editor.autoPairBrackets': defineBoolean({
    section: 'editor',
    group: 'Writing',
    scope: 'global',
    label: 'Auto-close brackets and quotes',
    default: true,
  }),

  'editor.codeLineNumbers': defineBoolean({
    section: 'editor',
    group: 'Writing',
    scope: 'global',
    label: 'Line numbers in code blocks',
    default: true,
  }),

  'links.openExternalInBrowser': defineBoolean({
    section: 'editor',
    group: 'Writing',
    scope: 'global',
    label: 'Open external links in the browser',
    default: true,
  }),

  // -- Attachments ----------------------------------------------------
  'attachments.location': defineEnum({
    section: 'editor',
    group: 'Attachments',
    scope: 'workspace',
    label: 'New attachment location',
    options: [
      { value: 'workspace-folder', label: 'In the folder below' },
      { value: 'next-to-note', label: 'Alongside the note' },
      { value: 'note-subfolder', label: 'In a subfolder of the note' },
    ],
    default: 'workspace-folder',
  }),

  'attachments.folder': defineText({
    section: 'editor',
    group: 'Attachments',
    scope: 'workspace',
    label: 'Attachment folder',
    default: 'attachments',
    placeholder: 'attachments',
    // Read as a workspace-relative path when the location is the workspace
    // folder, and as a subfolder name when it is relative to the note -- so it
    // stays relevant either way, and only `next-to-note` has nowhere to put it.
    visibleWhen: (get) => get('attachments.location') !== 'next-to-note',
  }),

  // -- Explorer -------------------------------------------------------
  'explorer.watchFilesystem': defineBoolean({
    section: 'explorer',
    scope: 'workspace',
    label: 'Watch for external changes',
    default: true,
    // Gates only the native watcher; the focus resync stays on regardless,
    // since it is the fallback. Applied in `fs-watch`, which subscribes to
    // this key -- keeping the wiring next to the watcher rather than making
    // the registry import it.
  }),

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
 * A setting's value type, taken off its declared default, so
 * `SettingValue<'appearance.theme'>` is `'system' | 'light' | 'dark'`.
 */
export type SettingValue<K extends SettingKey> =
  (typeof settingsRegistry)[K]['default'];

export const settingKeys = Object.keys(settingsRegistry) as SettingKey[];

export interface SettingEntry {
  key: SettingKey;
  def: AnySettingDef;
}

export function isSettingVisible(def: AnySettingDef, read: SettingReader) {
  return def.visibleWhen ? def.visibleWhen(read) : true;
}

/** Currently-visible settings for one section, in declaration order. */
export function visibleSettingsForSection(
  section: SectionId,
  read: SettingReader,
): SettingEntry[] {
  return settingKeys
    .map((key): SettingEntry => ({ key, def: settingsRegistry[key] }))
    .filter(({ def }) => def.section === section && isSettingVisible(def, read));
}
