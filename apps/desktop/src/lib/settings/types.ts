import type { SectionId } from './sections';

/**
 * Where a setting's value is allowed to live.
 *
 * - `global` — one value for the app, stored in the app data dir.
 * - `workspace` — overridable per workspace in `<workspace>/.solstice/settings.json`,
 *   falling back to the global value and then to `default`.
 */
export type SettingScope = 'global' | 'workspace';

/**
 * Reads another setting's resolved value, for `visibleWhen`.
 *
 * Loosely typed because `visibleWhen` is written inside the registry literal,
 * whose type is still being inferred at that point — referring to `SettingKey`
 * here would make the registry circularly reference itself. Keys are checked at
 * runtime instead.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SettingReader = (key: string) => any;

/** Applies a setting to a CSS custom property on `:root`. */
export interface CssVarBinding<V> {
  name: `--${string}`;
  format?: (value: V) => string;
}

/**
 * Applies a setting to several CSS custom properties at once, for one value
 * that drives a derived set — a heading scale ratio expanding into per-level
 * sizes. Computed in JS rather than with CSS `pow()`, which is not dependable
 * on the WebKitGTK build the Linux webview uses.
 */
export type CssVarsBinding<V> = (value: V) => Record<`--${string}`, string>;

/**
 * Applies a setting to an attribute on `<html>`, for values CSS selects on
 * (`[data-reduce-motion]`) or that HTML inherits down the tree (`spellcheck`,
 * which reaches the contenteditable without touching the editor).
 */
export interface DomAttrBinding<V> {
  name: string;
  format?: (value: V) => string;
}

interface CommonDef<V> {
  label: string;
  section: SectionId;
  /** Optional sub-heading; rows sharing a group render under it, in order. */
  group?: string;
  scope: SettingScope;
  default: V;
  /** Hide the row unless this passes, for options that depend on another. */
  visibleWhen?: (get: SettingReader) => boolean;
  /** Side effect beyond re-rendering; runs after the value is committed. */
  onChange?: (value: V) => void;
  cssVar?: CssVarBinding<V>;
  cssVars?: CssVarsBinding<V>;
  domAttr?: DomAttrBinding<V>;
}

export interface BooleanDef extends CommonDef<boolean> {
  kind: 'boolean';
}

export interface NumberDef extends CommonDef<number> {
  kind: 'number';
  min?: number;
  max?: number;
  step?: number;
  /** Suffix shown inside the control, e.g. `px`, `ms`, `ch`. */
  unit?: string;
  /** Omitted renders a numeric input. */
  control?: 'slider';
}

export interface TextDef extends CommonDef<string> {
  kind: 'text';
  /** Shown when the field is empty, i.e. what the default would be. */
  placeholder?: string;
}

export interface EnumOption<V extends string> {
  value: V;
  label: string;
}

export interface EnumDef<V extends string = string> extends CommonDef<V> {
  kind: 'enum';
  options: readonly EnumOption<V>[];
}

/**
 * Options that may not exist yet at module load — the theme catalogue is read
 * off disk. Called on every render and every coercion, so it must be cheap and
 * synchronous; anything expensive belongs behind a cache in its own module.
 */
export type OptionSource<V extends string> =
  | readonly EnumOption<V>[]
  | (() => readonly EnumOption<V>[]);

export function resolveOptions<V extends string>(
  source: OptionSource<V>,
): readonly EnumOption<V>[] {
  return typeof source === 'function' ? source() : source;
}

/**
 * An `enum` rendered as a compact dropdown rather than a stack of radio cards.
 * Same value semantics; the difference is that the option list may be long,
 * dynamic, or both, which the card list cannot carry.
 */
export interface SelectDef<V extends string = string> extends CommonDef<V> {
  kind: 'select';
  options: OptionSource<V>;
}

/**
 * A font family. The value is a bare family name, or `''` meaning "leave the
 * default in place" — which the binding renders as the existing fallback chain
 * rather than as an empty declaration.
 */
export interface FontDef extends CommonDef<string> {
  kind: 'font';
  /** Filters the bundled suggestions; installed families are never filtered. */
  suggest?: 'sans' | 'serif' | 'mono';
}

export type AnySettingDef =
  | BooleanDef
  | NumberDef
  | TextDef
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | EnumDef<any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | SelectDef<any>
  | FontDef;

// Each builder pins `kind` and widens `default` to the value type rather than
// the literal written, so `SettingValue<K>` resolves to `boolean` / `number` /
// the enum union rather than `true` / `16` / `'dark'`.

export function defineBoolean(def: Omit<BooleanDef, 'kind'>): BooleanDef {
  return { ...def, kind: 'boolean' };
}

export function defineNumber(def: Omit<NumberDef, 'kind'>): NumberDef {
  return { ...def, kind: 'number' };
}

export function defineText(def: Omit<TextDef, 'kind'>): TextDef {
  return { ...def, kind: 'text' };
}

/** `const V` infers the option values as literals, so the setting's type is their union. */
export function defineEnum<const V extends string>(
  def: Omit<EnumDef<V>, 'kind'>,
): EnumDef<V> {
  return { ...def, kind: 'enum' };
}

/**
 * Widened to `string` rather than the option literals: a select's options can
 * be dynamic, so the value union is not knowable from the declaration.
 */
export function defineSelect(def: Omit<SelectDef, 'kind'>): SelectDef {
  return { ...def, kind: 'select' };
}

export function defineFont(def: Omit<FontDef, 'kind'>): FontDef {
  return { ...def, kind: 'font' };
}
