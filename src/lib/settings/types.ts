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

export interface EnumOption<V extends string> {
  value: V;
  label: string;
}

export interface EnumDef<V extends string = string> extends CommonDef<V> {
  kind: 'enum';
  options: readonly EnumOption<V>[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnySettingDef = BooleanDef | NumberDef | EnumDef<any>;

// Each builder pins `kind` and widens `default` to the value type rather than
// the literal written, so `SettingValue<K>` resolves to `boolean` / `number` /
// the enum union rather than `true` / `16` / `'dark'`.

export function defineBoolean(def: Omit<BooleanDef, 'kind'>): BooleanDef {
  return { ...def, kind: 'boolean' };
}

export function defineNumber(def: Omit<NumberDef, 'kind'>): NumberDef {
  return { ...def, kind: 'number' };
}

/** `const V` infers the option values as literals, so the setting's type is their union. */
export function defineEnum<const V extends string>(
  def: Omit<EnumDef<V>, 'kind'>,
): EnumDef<V> {
  return { ...def, kind: 'enum' };
}
