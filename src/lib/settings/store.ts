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

/**
 * One layer of settings: a flat map of dotted key -> raw value, exactly as it
 * appears on disk. Deliberately not run through zustand's `persist`
 * middleware -- that wraps state in a `{ state, version }` envelope, and
 * these files are meant to be opened and edited by hand, the same way
 * keymap.json is. Unknown keys are kept as-is so a newer build's settings
 * survive being opened by an older one.
 */
type Layer = Record<string, unknown>;

interface SettingsState {
  global: Layer;
  workspace: Layer;
  globalLoaded: boolean;
  workspaceLoaded: boolean;
}

export const useSettingsStore = create<SettingsState>(() => ({
  global: {},
  workspace: {},
  globalLoaded: false,
  workspaceLoaded: false,
}));

// ---------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------

/**
 * Bring a raw on-disk value into range, or reject it. Returning `undefined`
 * means "this layer has nothing usable", so resolution falls through to the
 * next one rather than propagating a bad value. These files are user-editable,
 * so every read has to survive arbitrary JSON.
 */
function coerce(def: AnySettingDef, raw: unknown): unknown {
  if (raw === undefined || raw === null) return undefined;

  switch (def.kind) {
    case 'boolean':
      return typeof raw === 'boolean' ? raw : undefined;

    case 'number': {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined;
      return snapNumber(def, raw);
    }

    case 'string':
      return typeof raw === 'string' ? raw : undefined;

    case 'enum':
      return def.options.some((o) => o.value === raw) ? raw : undefined;

    case 'custom':
      return def.validate ? def.validate(raw) : raw;
  }
}

/** Decimal places implied by a step, e.g. 0.05 -> 2. */
function decimalsOf(step: number) {
  const text = String(step);
  const dot = text.indexOf('.');
  return dot === -1 ? 0 : text.length - dot - 1;
}

/**
 * Clamp into range and land on the step grid.
 *
 * The snapping is not cosmetic. A slider walks its range as `min + n * step`,
 * which in binary floating point drifts: 1.2 + 11 * 0.05 is 1.7500000000000002,
 * not 1.75. Without this, dragging back to the default would compare unequal to
 * the default forever -- the setting would look permanently customized and its
 * reset affordance would never clear.
 */
function snapNumber(def: NumberDef, raw: number) {
  let value = raw;
  if (def.min !== undefined) value = Math.max(def.min, value);
  if (def.max !== undefined) value = Math.min(def.max, value);

  if (def.step !== undefined && def.step > 0) {
    const origin = def.min ?? 0;
    value = origin + Math.round((value - origin) / def.step) * def.step;
    value = Number(value.toFixed(decimalsOf(def.step)));
  }

  return value;
}

/** Put an incoming value into the same shape a stored one would resolve to. */
function normalizeValue(def: AnySettingDef, value: unknown) {
  if (def.kind === 'number' && typeof value === 'number' && Number.isFinite(value)) {
    return snapNumber(def, value);
  }
  return value;
}

// ---------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------

export { resolveFrom as resolveSetting };

function resolveFrom<K extends SettingKey>(
  key: K,
  global: Layer,
  workspace: Layer,
): SettingValue<K> {
  const def = settingsRegistry[key];

  // A workspace override only counts for settings that opted into being
  // overridable; a stray key in the workspace file is otherwise ignored.
  if (def.scope === 'workspace') {
    const override = coerce(def, workspace[key]);
    if (override !== undefined) return override as SettingValue<K>;
  }

  const globalValue = coerce(def, global[key]);
  if (globalValue !== undefined) return globalValue as SettingValue<K>;

  return def.default as SettingValue<K>;
}

/** Non-reactive read, for imperative call sites (autosave, event handlers). */
export function getSetting<K extends SettingKey>(key: K): SettingValue<K> {
  const { global, workspace } = useSettingsStore.getState();
  return resolveFrom(key, global, workspace);
}

/**
 * Reactive read. The selector returns a primitive for every built-in kind, so
 * it is referentially stable; an object-valued `custom` setting should be read
 * through `useSettingsStore` with `useShallow` instead.
 */
export function useSetting<K extends SettingKey>(key: K): SettingValue<K> {
  return useSettingsStore((s) => resolveFrom(key, s.global, s.workspace));
}

export interface SettingMeta<K extends SettingKey> {
  value: SettingValue<K>;
  def: (typeof settingsRegistry)[K];
  /** A workspace override exists and is what `value` came from. */
  isOverridden: boolean;
  /**
   * The resolved value differs from the registry default -- i.e. there is
   * something for a reset to actually do. Deliberately compares the value
   * rather than asking whether a key is stored: a stored value that happens
   * to equal the default is not a customization from the user's point of
   * view. (Object-valued `custom` settings compare by reference; give them a
   * primitive representation if that matters.)
   */
  isCustomized: boolean;
  /**
   * The layer `value` was actually read from, or null when it fell through to
   * the default. Resetting has to clear *this* layer -- a workspace-scoped
   * setting whose only stored value is global lives in the global file.
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
 * A reader over the current values, for `visibleWhen`. Subscribes the caller
 * to both layers, so a dependent row appears the moment its condition flips.
 */
export function useSettingReader(): SettingReader {
  const { global, workspace } = useSettingsStore(
    useShallow((s) => ({ global: s.global, workspace: s.workspace })),
  );
  // The cast pairs with SettingReader being loosely typed -- see its comment.
  return (key: string) => resolveFrom(key as SettingKey, global, workspace);
}

// ---------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------

async function fileFor(scope: SettingScope) {
  if (scope === 'workspace' && !hasOpenWorkspace()) {
    // Without this the workspace layer would fall back to the app data dir
    // and land on the *global* layer's settings.json -- same path, same keys,
    // silently clobbering it. Every caller already guards; this is the backstop.
    throw new Error('No workspace is open, so there is nowhere to store an override');
  }
  return getScopedStore(
    SETTINGS_FILE,
    scope === 'global' ? 'global' : 'workspace',
  );
}

async function readLayer(scope: SettingScope): Promise<Layer> {
  const store = await fileFor(scope);
  const entries = await store.entries();
  return Object.fromEntries(entries);
}

export async function loadGlobalSettings() {
  try {
    const global = await readLayer('global');
    useSettingsStore.setState({ global, globalLoaded: true });
  } catch (error) {
    console.error('Failed to load global settings:', error);
    useSettingsStore.setState({ globalLoaded: true });
  }
  migrateLegacyTheme();
}

/**
 * Called from `syncScopedStores` on every workspace switch. With no workspace
 * open the layer is simply empty -- overrides have nowhere to live.
 */
export async function loadWorkspaceSettings() {
  if (!hasOpenWorkspace()) {
    useSettingsStore.setState({ workspace: {}, workspaceLoaded: true });
    return;
  }
  try {
    const workspace = await readLayer('workspace');
    useSettingsStore.setState({ workspace, workspaceLoaded: true });
  } catch (error) {
    console.error('Failed to load workspace settings:', error);
    useSettingsStore.setState({ workspace: {}, workspaceLoaded: true });
  }
}

/**
 * Coalesced file writes, keyed by layer + setting.
 *
 * A slider drag calls the setter once per pointer step, and each call would
 * otherwise be its own write to the store file. The in-memory layer still
 * updates synchronously -- only the trip to disk waits -- and because each
 * call carries the whole intended state for its key, last-write-wins is
 * exactly right.
 */
const WRITE_DEBOUNCE_MS = 150;
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

/**
 * Write a value. Defaults to the setting's declared scope, so callers that do
 * not care about layering never have to think about it. Only keys that differ
 * from the default are ever written -- the files stay short and readable.
 */
export function setSetting<K extends SettingKey>(
  key: K,
  value: SettingValue<K>,
  scope?: SettingScope,
) {
  setSettingRaw(key, value, scope);
}

/**
 * The same write, without the key/value type link. For generated UI that only
 * knows the key at runtime -- the control it rendered came from that key's own
 * definition, so the value is correct by construction.
 */
export function setSettingRaw(
  key: SettingKey,
  value: unknown,
  scope?: SettingScope,
) {
  const def = settingsRegistry[key] as AnySettingDef;
  const target: SettingScope = scope ?? def.scope;

  // Normalize before anything compares it, so a slider landing on the default
  // is recognized as the default rather than as default-plus-float-dust.
  value = normalizeValue(def, value);

  if (target === 'workspace' && !hasOpenWorkspace()) {
    console.warn(`Cannot set "${key}" per workspace with no workspace open`);
    return;
  }

  const { global, workspace } = useSettingsStore.getState();
  const layer = target === 'global' ? global : workspace;

  // If this key were absent, what would the setting resolve to? When that
  // already equals what the user just picked, storing it would be a no-op
  // entry that makes the row look customized forever -- so drop the key
  // instead. Turning a setting back to its default therefore leaves no trace
  // in the file and clears the row's reset affordance on its own.
  const without = { ...layer };
  delete without[key];
  const fallback =
    target === 'global'
      ? resolveFrom(key, without, workspace)
      : resolveFrom(key, global, without);

  const redundant = fallback === value;
  applyLayer(target, redundant ? without : { ...layer, [key]: value });
  persist(target, key, redundant ? { type: 'delete' } : { type: 'set', value });

  (def.onChange as ((v: unknown) => void) | undefined)?.(value);
}

/**
 * Drop a value from one layer. On a workspace-scoped setting this is
 * "revert to the global value"; on the global layer it is "revert to default".
 */
export function resetSetting(key: SettingKey, scope?: SettingScope) {
  const def = settingsRegistry[key];
  const target: SettingScope = scope ?? def.scope;

  const layer = useSettingsStore.getState()[target];
  if (!(key in layer)) return;

  const next = { ...layer };
  delete next[key];
  applyLayer(target, next);
  persist(target, key, { type: 'delete' });

  ((def as AnySettingDef).onChange as ((v: unknown) => void) | undefined)?.(
    getSetting(key),
  );
}

/** Fires whenever a setting's resolved value changes. For imperative consumers. */
export function subscribeToSetting<K extends SettingKey>(
  key: K,
  listener: (value: SettingValue<K>) => void,
) {
  return useSettingsStore.subscribe((state, prev) => {
    const next = resolveFrom(key, state.global, state.workspace);
    const before = resolveFrom(key, prev.global, prev.workspace);
    if (next !== before) listener(next);
  });
}

// ---------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------

const LEGACY_THEME_KEY = 'vite-ui-theme';

/**
 * Theme used to be the app's only localStorage user. Move any existing choice
 * into the global layer once, then drop the old key.
 */
function migrateLegacyTheme() {
  let legacy: string | null = null;
  try {
    legacy = localStorage.getItem(LEGACY_THEME_KEY);
  } catch {
    return;
  }
  if (!legacy) return;

  const { global } = useSettingsStore.getState();
  if (!('appearance.theme' in global)) {
    const def = settingsRegistry['appearance.theme'];
    if (def.options.some((o) => o.value === legacy)) {
      setSetting('appearance.theme', legacy as SettingValue<'appearance.theme'>);
    }
  }
  localStorage.removeItem(LEGACY_THEME_KEY);
}
