import { create } from 'zustand';
import { useShallow } from 'zustand/shallow';
import { getScopedStore, hasOpenWorkspace } from '@/lib/stores/scoped-storage';
import {
  settingsRegistry,
  type SettingKey,
  type SettingValue,
} from './registry';
import type {
  AnySettingDef,
  NumberDef,
  SettingReader,
  SettingScope,
} from './types';

const SETTINGS_FILE = 'settings.json';
const WRITE_DEBOUNCE_MS = 150;

/**
 * One layer of settings, as a flat map of dotted key to raw value — the exact
 * shape on disk. Kept out of zustand's `persist` middleware, which would wrap
 * it in a `{ state, version }` envelope; these files are meant to be opened and
 * edited by hand. Unknown keys are preserved so a newer build's settings
 * survive being opened by an older one.
 */
type Layer = Record<string, unknown>;

interface SettingsState {
  global: Layer;
  workspace: Layer;
  globalLoaded: boolean;
}

export const useSettingsStore = create<SettingsState>(() => ({
  global: {},
  workspace: {},
  globalLoaded: false,
}));

/** Clamp into the declared range. */
export function clampToRange(def: NumberDef, value: number) {
  let next = value;
  if (def.min !== undefined) next = Math.max(def.min, next);
  if (def.max !== undefined) next = Math.min(def.max, next);
  return next;
}

function decimalsOf(step: number) {
  const text = String(step);
  const dot = text.indexOf('.');
  return dot === -1 ? 0 : text.length - dot - 1;
}

/**
 * Clamp and land on the step grid. A slider walks its range as `min + n * step`,
 * which drifts in binary floating point (1.2 + 11 * 0.05 is 1.7500000000000002),
 * so without snapping a value dragged back to its default never compares equal
 * to it and the setting reads as permanently customized.
 */
function snapNumber(def: NumberDef, value: number) {
  const clamped = clampToRange(def, value);
  if (def.step === undefined || def.step <= 0) return clamped;

  const origin = def.min ?? 0;
  const snapped = origin + Math.round((clamped - origin) / def.step) * def.step;
  return Number(snapped.toFixed(decimalsOf(def.step)));
}

/**
 * Bring a raw value into range, or reject it. `undefined` means "this layer has
 * nothing usable", so resolution falls through rather than propagating garbage —
 * these files are user-editable, so every read must survive arbitrary JSON.
 */
function coerce(def: AnySettingDef, raw: unknown): unknown {
  if (raw === undefined || raw === null) return undefined;

  switch (def.kind) {
    case 'boolean':
      return typeof raw === 'boolean' ? raw : undefined;
    case 'number':
      return typeof raw === 'number' && Number.isFinite(raw)
        ? snapNumber(def, raw)
        : undefined;
    case 'enum':
      return def.options.some((o) => o.value === raw) ? raw : undefined;
  }
}

export function resolveSetting<K extends SettingKey>(
  key: K,
  global: Layer,
  workspace: Layer,
): SettingValue<K> {
  const def = settingsRegistry[key];

  // A stray key in the workspace file is ignored unless the setting opted in.
  if (def.scope === 'workspace') {
    const override = coerce(def, workspace[key]);
    if (override !== undefined) return override as SettingValue<K>;
  }

  const globalValue = coerce(def, global[key]);
  if (globalValue !== undefined) return globalValue as SettingValue<K>;

  return def.default as SettingValue<K>;
}

/** Non-reactive read, for imperative call sites. */
export function getSetting<K extends SettingKey>(key: K): SettingValue<K> {
  const { global, workspace } = useSettingsStore.getState();
  return resolveSetting(key, global, workspace);
}

export function useSetting<K extends SettingKey>(key: K): SettingValue<K> {
  return useSettingsStore((s) => resolveSetting(key, s.global, s.workspace));
}

export interface SettingMeta<K extends SettingKey> {
  value: SettingValue<K>;
  def: (typeof settingsRegistry)[K];
  /** A workspace override exists and is where `value` came from. */
  isOverridden: boolean;
  /**
   * The value differs from the default, so a reset has something to do.
   * Compares the value rather than asking whether a key is stored: a stored
   * value that happens to equal the default is not a customization.
   */
  isCustomized: boolean;
  /**
   * The layer `value` came from, or null when it fell through to the default.
   * A reset must clear this layer — a workspace-scoped setting whose only
   * stored value is global lives in the global file.
   */
  effectiveScope: SettingScope | null;
}

export function useSettingWithMeta<K extends SettingKey>(
  key: K,
): SettingMeta<K> {
  const def = settingsRegistry[key];
  const value = useSetting(key);
  const rawWorkspace = useSettingsStore((s) => s.workspace[key]);
  const rawGlobal = useSettingsStore((s) => s.global[key]);

  const isOverridden =
    def.scope === 'workspace' && coerce(def, rawWorkspace) !== undefined;
  const hasGlobal = coerce(def, rawGlobal) !== undefined;

  return {
    value,
    def,
    isOverridden,
    isCustomized: value !== def.default,
    effectiveScope: isOverridden ? 'workspace' : hasGlobal ? 'global' : null,
  };
}

/**
 * A reader over the current values, for `visibleWhen`. Subscribes the caller to
 * both layers, so a dependent row appears the moment its condition flips.
 */
export function useSettingReader(): SettingReader {
  const { global, workspace } = useSettingsStore(
    useShallow((s) => ({ global: s.global, workspace: s.workspace })),
  );
  return (key: string) => resolveSetting(key as SettingKey, global, workspace);
}

async function fileFor(scope: SettingScope) {
  if (scope === 'workspace' && !hasOpenWorkspace()) {
    // Otherwise this resolves to the app data dir and collides with the global
    // layer's own settings.json.
    throw new Error('No workspace is open, so there is nowhere to store an override');
  }
  return getScopedStore(SETTINGS_FILE, scope);
}

async function loadLayer(scope: SettingScope) {
  let layer: Layer = {};
  if (scope === 'global' || hasOpenWorkspace()) {
    try {
      layer = Object.fromEntries(await (await fileFor(scope)).entries());
    } catch (error) {
      console.error(`Failed to load ${scope} settings:`, error);
    }
  }
  useSettingsStore.setState(
    scope === 'global' ? { global: layer, globalLoaded: true } : { workspace: layer },
  );
}

export const loadGlobalSettings = () => loadLayer('global');

/** Called from `syncScopedStores` on every workspace switch. */
export const loadWorkspaceSettings = () => loadLayer('workspace');

/**
 * File writes coalesced per layer and key. A slider drag calls the setter once
 * per pointer step; the in-memory layer still updates synchronously and only
 * the trip to disk waits. Each call carries the whole intended state for its
 * key, so last-write-wins is correct.
 */
const pendingWrites = new Map<string, ReturnType<typeof setTimeout>>();

function persist(
  target: SettingScope,
  key: SettingKey,
  op: { type: 'set'; value: unknown } | { type: 'delete' },
) {
  const id = `${target}:${key}`;
  const queued = pendingWrites.get(id);
  if (queued) clearTimeout(queued);

  pendingWrites.set(
    id,
    setTimeout(async () => {
      pendingWrites.delete(id);
      try {
        const store = await fileFor(target);
        if (op.type === 'delete') await store.delete(key);
        else await store.set(key, op.value);
      } catch (error) {
        console.error(`Failed to persist setting "${key}":`, error);
      }
    }, WRITE_DEBOUNCE_MS),
  );
}

function applyLayer(scope: SettingScope, next: Layer) {
  useSettingsStore.setState(
    scope === 'global' ? { global: next } : { workspace: next },
  );
}

function runOnChange(def: AnySettingDef, value: unknown) {
  (def.onChange as ((v: unknown) => void) | undefined)?.(value);
}

/**
 * Write a value, defaulting to the setting's declared scope. Only values that
 * differ from what the key would resolve to without them are stored, so the
 * files stay short and a setting returned to its default leaves no trace.
 */
export function setSetting<K extends SettingKey>(
  key: K,
  value: SettingValue<K>,
  scope?: SettingScope,
) {
  const def = settingsRegistry[key] as AnySettingDef;
  const target: SettingScope = scope ?? def.scope;

  if (target === 'workspace' && !hasOpenWorkspace()) {
    console.warn(`Cannot set "${key}" per workspace with no workspace open`);
    return;
  }

  // Normalize first, so a slider landing on the default is recognized as the
  // default rather than as default-plus-float-drift.
  const next = (coerce(def, value) ?? value) as SettingValue<K>;

  const { global, workspace } = useSettingsStore.getState();
  const layer = target === 'global' ? global : workspace;
  const without = { ...layer };
  delete without[key];

  const fallback =
    target === 'global'
      ? resolveSetting(key, without, workspace)
      : resolveSetting(key, global, without);

  const redundant = fallback === next;
  applyLayer(target, redundant ? without : { ...layer, [key]: next });
  persist(target, key, redundant ? { type: 'delete' } : { type: 'set', value: next });

  runOnChange(def, next);
}

/**
 * The same write without the key/value type link, for generated UI that only
 * knows the key at runtime. The control was rendered from that key's own
 * definition, so the value is correct by construction.
 */
export const setSettingRaw = setSetting as (
  key: SettingKey,
  value: unknown,
  scope?: SettingScope,
) => void;

/**
 * Drop a value from one layer: on a workspace-scoped setting this reverts to
 * the global value, on the global layer it reverts to the default.
 */
export function resetSetting(key: SettingKey, scope?: SettingScope) {
  const def = settingsRegistry[key] as AnySettingDef;
  const target: SettingScope = scope ?? def.scope;

  const layer = useSettingsStore.getState()[target];
  if (!(key in layer)) return;

  const next = { ...layer };
  delete next[key];
  applyLayer(target, next);
  persist(target, key, { type: 'delete' });

  runOnChange(def, getSetting(key));
}

/** Fires whenever a setting's resolved value changes, for imperative consumers. */
export function subscribeToSetting<K extends SettingKey>(
  key: K,
  listener: (value: SettingValue<K>) => void,
) {
  return useSettingsStore.subscribe((state, prev) => {
    const next = resolveSetting(key, state.global, state.workspace);
    const before = resolveSetting(key, prev.global, prev.workspace);
    if (next !== before) listener(next);
  });
}
