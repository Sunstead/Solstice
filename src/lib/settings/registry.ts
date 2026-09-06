import type { SectionId } from './sections';
import { themeOptions } from '@/lib/theme/store';
import { fontStack } from '@/lib/theme/fonts';
import {
  defineBoolean,
  defineEnum,
  defineFont,
  defineNumber,
  defineSelect,
  defineText,
  type AnySettingDef,
  type SettingReader,
} from './types';

/**
 * Heading sizes as exponents of one scale ratio, chosen so the default ratio
 * of 1.25 reproduces the sizes the typeset stylesheet shipped with (1.75em /
 * 1.25em / 1.125em / 1em) to three decimal places. Turning the ratio up or
 * down then stretches the whole ladder while keeping their relationship.
 */
const HEADING_EXPONENTS = { 1: 2.51, 2: 1, 3: 0.53, 4: 0 } as const;

function headingSizes(ratio: number) {
  return Object.fromEntries(
    Object.entries(HEADING_EXPONENTS).map(([level, exponent]) => [
      `--editor-h${level}-size`,
      `${(ratio ** exponent).toFixed(3)}em`,
    ]),
  );
}

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
  // -- Theme ---------------------------------------------------------
  'theme.mode': defineEnum({
    section: 'theme',
    scope: 'global',
    label: 'Theme mode',
    options: [
      { value: 'fixed', label: 'A single theme' },
      { value: 'system', label: 'Follow the system, light and dark' },
    ],
    default: 'fixed',
  }),

  // The three preset keys are dynamic selects rather than enums: the option
  // list includes whatever theme files the workspace happens to hold, which is
  // not knowable when this module is evaluated.
  'theme.preset': defineSelect({
    section: 'theme',
    scope: 'global',
    label: 'Theme',
    options: () => themeOptions(),
    default: 'solstice-dark',
    visibleWhen: (get) => get('theme.mode') === 'fixed',
  }),

  'theme.lightPreset': defineSelect({
    section: 'theme',
    scope: 'global',
    label: 'Light theme',
    options: () => themeOptions('light'),
    default: 'solstice-light',
    visibleWhen: (get) => get('theme.mode') === 'system',
  }),

  'theme.darkPreset': defineSelect({
    section: 'theme',
    scope: 'global',
    label: 'Dark theme',
    options: () => themeOptions('dark'),
    default: 'solstice-dark',
    visibleWhen: (get) => get('theme.mode') === 'system',
  }),

  'appearance.reduceMotion': defineBoolean({
    section: 'accessibility',
    scope: 'global',
    label: 'Reduce motion',
    default: false,
    domAttr: { name: 'data-reduce-motion', format: (v) => String(v) },
  }),

  // -- Typography / Fonts ---------------------------------------------
  // Every font setting stores a bare family name, with `''` meaning "leave the
  // default in place" -- which `apply.ts` turns into removing the variable, so
  // the stylesheet's own `var(--x, fallback)` can reach its fallback.
  'editor.fontBody': defineFont({
    section: 'typography',
    group: 'Fonts',
    scope: 'global',
    label: 'Note font',
    default: '',
    suggest: 'serif',
    cssVar: { name: '--editor-font-body', format: (v) => fontStack(v, 'sans') },
  }),

  'editor.fontHeading': defineFont({
    section: 'typography',
    group: 'Fonts',
    scope: 'global',
    label: 'Heading font',
    default: '',
    suggest: 'sans',
    cssVar: { name: '--editor-font-heading', format: (v) => fontStack(v, 'sans') },
  }),

  'editor.fontMono': defineFont({
    section: 'typography',
    group: 'Fonts',
    scope: 'global',
    label: 'Code font',
    default: '',
    suggest: 'mono',
    cssVar: { name: '--editor-font-mono', format: (v) => fontStack(v, 'mono') },
  }),

  'editor.monoLigatures': defineBoolean({
    section: 'typography',
    group: 'Fonts',
    scope: 'global',
    label: 'Code ligatures',
    // Most programming faces ship them on; the ones that do are the reason
    // someone picks the face, so the default follows the font's own intent.
    default: true,
    cssVar: {
      name: '--editor-mono-ligatures',
      format: (v) => (v ? 'normal' : 'none'),
    },
  }),

  'ui.font': defineFont({
    section: 'typography',
    group: 'Fonts',
    scope: 'global',
    label: 'Interface font',
    default: '',
    suggest: 'sans',
    cssVar: { name: '--editor-font-ui', format: (v) => fontStack(v, 'sans') },
  }),

  // -- Typography / Metrics -------------------------------------------
  'editor.fontSize': defineNumber({
    section: 'typography',
    group: 'Metrics',
    scope: 'global',
    label: 'Font size',
    default: 16,
    min: 10,
    max: 32,
    step: 1,
    unit: 'px',
    cssVar: { name: '--editor-font-size', format: (v) => `${v}px` },
  }),

  'editor.lineHeight': defineNumber({
    section: 'typography',
    group: 'Metrics',
    scope: 'global',
    label: 'Line height',
    default: 1.75,
    min: 1.2,
    max: 2.4,
    step: 0.05,
    control: 'slider',
    cssVar: { name: '--editor-line-height' },
  }),

  'editor.lineWidth': defineNumber({
    section: 'typography',
    group: 'Metrics',
    scope: 'global',
    label: 'Line length',
    default: 80,
    min: 40,
    max: 160,
    step: 4,
    unit: 'ch',
    control: 'slider',
    cssVar: { name: '--editor-measure', format: (v) => `${v}ch` },
  }),

  'editor.letterSpacing': defineNumber({
    section: 'typography',
    group: 'Metrics',
    scope: 'global',
    label: 'Letter spacing',
    default: 0,
    min: -0.02,
    max: 0.06,
    step: 0.005,
    unit: 'em',
    control: 'slider',
    cssVar: { name: '--editor-letter-spacing', format: (v) => `${v}em` },
  }),

  'editor.paragraphSpacing': defineNumber({
    section: 'typography',
    group: 'Metrics',
    scope: 'global',
    label: 'Paragraph spacing',
    default: 1.25,
    min: 0.75,
    max: 2.5,
    step: 0.05,
    unit: 'em',
    control: 'slider',
    // Drives every block's leading margin, not just paragraphs -- it is the
    // one rhythm value the whole typeset is measured against.
    cssVar: { name: '--editor-flow', format: (v) => `${v}em` },
  }),

  'editor.codeFontScale': defineNumber({
    section: 'typography',
    group: 'Metrics',
    scope: 'global',
    label: 'Code size',
    default: 0.875,
    min: 0.75,
    max: 1.1,
    step: 0.005,
    control: 'slider',
    cssVar: { name: '--editor-code-scale' },
  }),

  // -- Typography / Headings ------------------------------------------
  'editor.headingScale': defineNumber({
    section: 'typography',
    group: 'Headings',
    scope: 'global',
    label: 'Heading scale',
    default: 1.25,
    min: 1,
    max: 1.5,
    step: 0.01,
    control: 'slider',
    // One value, four variables: see `headingSizes` above for why the ladder
    // is computed here rather than with CSS `pow()`.
    cssVars: headingSizes,
  }),

  'editor.headingWeight': defineSelect({
    section: 'typography',
    group: 'Headings',
    scope: 'global',
    label: 'Heading weight',
    options: [
      { value: '400', label: 'Regular' },
      { value: '500', label: 'Medium' },
      { value: '600', label: 'Semibold' },
      { value: '700', label: 'Bold' },
      { value: '800', label: 'Extrabold' },
    ],
    default: '600',
    cssVar: { name: '--editor-heading-weight' },
  }),

  // -- Typography / Layout --------------------------------------------
  'editor.textAlign': defineEnum({
    section: 'typography',
    group: 'Layout',
    scope: 'global',
    label: 'Text alignment',
    options: [
      { value: 'left', label: 'Ragged right' },
      { value: 'justify', label: 'Justified' },
    ],
    default: 'left',
    cssVar: { name: '--editor-text-align' },
  }),

  'editor.hyphenate': defineBoolean({
    section: 'typography',
    group: 'Layout',
    scope: 'global',
    label: 'Hyphenate',
    default: false,
    cssVar: {
      name: '--editor-hyphens',
      format: (v) => (v ? 'auto' : 'manual'),
    },
    // Justified text without hyphenation opens rivers at a narrow measure,
    // which is the only place the option earns its row.
    visibleWhen: (get) => get('editor.textAlign') === 'justify',
  }),

  'editor.scrollPastEnd': defineBoolean({
    section: 'typography',
    group: 'Layout',
    scope: 'global',
    label: 'Scroll past end',
    default: true,
    cssVar: {
      name: '--editor-pad-bottom',
      format: (v) => (v ? '10rem' : '2rem'),
    },
  }),

  // -- File viewers ---------------------------------------------------

  'viewer.imageBackground': defineEnum({
    section: 'appearance',
    group: 'File viewers',
    scope: 'global',
    label: 'Image background',
    options: [
      { value: 'app', label: 'Match the app' },
      { value: 'checkerboard', label: 'Checkerboard' },
      { value: 'dark', label: 'Neutral dark' },
    ],
    // Neutral dark suits photographs and checkerboard suits transparency, but
    // most images in a vault are diagrams and screenshots that read best on
    // the same ground as the notes around them.
    default: 'app',
    domAttr: { name: 'data-image-bg' },
  }),

  'viewer.imageGrid': defineBoolean({
    section: 'appearance',
    group: 'File viewers',
    scope: 'global',
    label: 'Image canvas grid',
    default: true,
    // Fading the layer rather than hiding it, so the setting is one value the
    // stylesheet already reads.
    cssVar: {
      name: '--canvas-grid-opacity',
      format: (v) => (v ? '0.3' : '0'),
    },
    visibleWhen: (get) => get('viewer.imageBackground') !== 'checkerboard',
  }),

  'viewer.mediaAutoplay': defineBoolean({
    section: 'appearance',
    group: 'File viewers',
    scope: 'global',
    label: 'Play media on open',
    default: false,
  }),

  // -- Canvas ---------------------------------------------------------
  'canvas.showGrid': defineBoolean({
    section: 'appearance',
    group: 'Canvas',
    scope: 'global',
    label: 'Canvas grid',
    default: true,
    // Its own variable rather than reusing `--canvas-grid-opacity`: that one is
    // the image viewer's, and hiding the dots behind a photograph should not
    // also strip the surface a board is drawn on.
    cssVar: {
      name: '--canvas-board-grid-opacity',
      format: (v) => (v ? '0.35' : '0'),
    },
  }),

  'canvas.snapToGrid': defineBoolean({
    section: 'editor',
    group: 'Canvas',
    scope: 'workspace',
    label: 'Snap to grid',
    // On by default: a board that tidies itself is worth more than pixel
    // placement, and holding Alt (or Cmd) turns it off for the one drag that
    // needs it.
    default: true,
  }),

  'canvas.showMinimap': defineBoolean({
    section: 'appearance',
    group: 'Canvas',
    scope: 'global',
    label: 'Canvas minimap',
    // Off by default: it only earns its corner on a board too large to see.
    default: false,
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
