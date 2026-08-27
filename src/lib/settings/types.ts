import type * as React from 'react';
import type { SectionId } from './sections';

/**
 * Where a setting's value is allowed to live.
 *
 * - `global`   -- one value for the app, stored in the app data dir.
 * - `workspace`-- overridable per workspace in `<workspace>/.solstice/settings.json`,
 *                 falling back to the global value and then to `default`.
 */
export type SettingScope = 'global' | 'workspace';

/**
 * Reads another setting's resolved value; passed to `visibleWhen`.
 *
 * Typed loosely on purpose. `visibleWhen` is written inside the registry
 * literal, whose type is still being inferred at that point -- a signature
 * referring to `SettingKey`/`SettingValue` would make the registry
 * circularly reference itself. Keys are checked at runtime instead.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SettingReader = (key: string) => any;

/**
 * Applies a setting to a CSS custom property on `:root`. Most appearance
 * settings need nothing beyond this -- the stylesheets already consume vars
 * (see `styles/typeset.css`), so no component has to know the setting exists.
 */
export interface CssVarBinding<V> {
  name: `--${string}`;
  format?: (value: V) => string;
}

/**
 * Applies a setting to an attribute on `<html>`. For things CSS selectors key
 * off (`[data-reduce-motion]`) or that HTML inherits down the tree
 * (`spellcheck`, which reaches the contenteditable without touching the editor).
 */
export interface DomAttrBinding<V> {
  name: string;
  format?: (value: V) => string;
}

interface CommonDef<V> {
  label: string;
  description?: string;
  section: SectionId;
  /** Optional sub-heading; rows sharing a group render under it, in order. */
  group?: string;
  scope: SettingScope;
  default: V;
  /** Hide the row unless this passes -- for options that depend on another. */
  visibleWhen?: (get: SettingReader) => boolean;
  /** Side effect beyond re-rendering; runs after the value is committed. */
  onChange?: (value: V) => void;
  /** Render a "takes effect after reopening the note" note under the row. */
  requiresReload?: boolean;
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
  control?: 'stepper' | 'slider';
}

export interface StringDef extends CommonDef<string> {
  kind: 'string';
  placeholder?: string;
}

export interface EnumOption<V extends string> {
  value: V;
  label: string;
  description?: string;
}

export interface EnumDef<V extends string = string> extends CommonDef<V> {
  kind: 'enum';
  options: readonly EnumOption<V>[];
  /**
   * `radio` (the default) lists every option with its description visible,
   * which is what you want for a handful of choices. `select` collapses them
   * into a dropdown -- only worth it for long lists.
   */
  control?: 'radio' | 'select';
}

export interface ControlProps<V> {
  value: V;
  onChange: (value: V) => void;
}

/**
 * The escape hatch: any control the four built-in kinds can't express -- a
 * colour picker, a font picker, the keybind recorder. Supplies its own
 * validation because the store has no way to check an opaque value.
 */
export interface CustomDef<V = unknown> extends CommonDef<V> {
  kind: 'custom';
  component: React.ComponentType<ControlProps<V>>;
  validate?: (raw: unknown) => V | undefined;
}

export type AnySettingDef =
  | BooleanDef
  | NumberDef
  | StringDef
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | EnumDef<any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | CustomDef<any>;

// ---------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------
// Each one exists to pin `kind` and to widen `default` to the value type
// rather than the literal you wrote, so `SettingValue<K>` -- which is just
// `(typeof settingsRegistry)[K]['default']` -- comes out as `boolean` /
// `number` / the enum union rather than `true` / `16` / `'dark'`.

export function defineBoolean(def: Omit<BooleanDef, 'kind'>): BooleanDef {
  return { ...def, kind: 'boolean' };
}

export function defineNumber(def: Omit<NumberDef, 'kind'>): NumberDef {
  return { ...def, kind: 'number' };
}

export function defineString(def: Omit<StringDef, 'kind'>): StringDef {
  return { ...def, kind: 'string' };
}

/**
 * `const V` makes the option `value`s infer as literals, so the setting's
 * value type is the union of exactly those options.
 */
export function defineEnum<const V extends string>(
  def: Omit<EnumDef<V>, 'kind'>,
): EnumDef<V> {
  return { ...def, kind: 'enum' };
}

export function defineCustom<V>(def: Omit<CustomDef<V>, 'kind'>): CustomDef<V> {
  return { ...def, kind: 'custom' };
}
