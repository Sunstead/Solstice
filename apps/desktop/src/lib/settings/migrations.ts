/**
 * One-shot rewrites of settings files written by earlier builds.
 *
 * These files are flat, hand-editable JSON that preserves unknown keys, so a
 * renamed setting does not disappear on its own -- it sits there being ignored
 * while the user wonders why their preference stopped applying. Each migration
 * below moves the value across and removes the old key, so the file ends up
 * describing what the app actually reads.
 */

type Layer = Record<string, unknown>;

export interface LayerPatch {
  set: Record<string, unknown>;
  remove: string[];
}

const EMPTY: LayerPatch = { set: {}, remove: [] };

function isEmpty(patch: LayerPatch) {
  return patch.remove.length === 0 && Object.keys(patch.set).length === 0;
}

export const hasWork = (patch: LayerPatch) => !isEmpty(patch);

/**
 * `appearance.theme` (system | light | dark) became the `theme.*` keys, where
 * the choice of palette and the choice of whether to follow the OS are
 * separate questions.
 */
export function migrateGlobal(global: Layer): LayerPatch {
  const legacy = global['appearance.theme'];
  if (legacy === undefined) return EMPTY;

  const patch: LayerPatch = { set: {}, remove: ['appearance.theme'] };
  if (legacy === 'system') {
    patch.set['theme.mode'] = 'system';
  } else if (legacy === 'light') {
    patch.set['theme.preset'] = 'solstice-light';
  } else if (legacy === 'dark') {
    patch.set['theme.preset'] = 'solstice-dark';
  }
  return patch;
}

/**
 * The typography settings kept their keys but became global rather than
 * per-workspace. Resolution only consults the workspace layer for keys that
 * are still workspace-scoped, so a value sitting in a workspace file would
 * silently stop applying -- copy it up to the global layer instead.
 *
 * The workspace entry is left in place: it is harmless now that the key is
 * global, and removing a value from a file the user may have hand-edited is a
 * worse failure than leaving a stale line behind.
 */
const RESCOPED_TO_GLOBAL = [
  'editor.fontSize',
  'editor.lineHeight',
  'editor.lineWidth',
  'editor.scrollPastEnd',
];

export function migrateRescopedTypography(
  workspace: Layer,
  global: Layer,
): LayerPatch {
  const patch: LayerPatch = { set: {}, remove: [] };

  for (const key of RESCOPED_TO_GLOBAL) {
    // Only when the global layer has nothing to say: an explicit global value
    // is the newer answer and must not be overwritten by an old vault's.
    if (key in workspace && !(key in global)) patch.set[key] = workspace[key];
  }

  return patch;
}
