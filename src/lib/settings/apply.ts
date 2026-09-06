import { useEffect } from 'react';
import { useShallow } from 'zustand/shallow';
import { settingKeys, settingsRegistry } from './registry';
import { resolveSetting, useSettingsStore } from './store';

type Binding = { name: string; format?: (value: never) => string };

function render(binding: Binding, value: unknown) {
  const format = binding.format as ((v: unknown) => string) | undefined;
  return format ? format(value) : String(value);
}

/**
 * An empty string removes the property rather than declaring it empty, which
 * is how a setting says "leave the default alone": the stylesheet's own
 * `var(--x, fallback)` can only reach its fallback if `--x` is genuinely
 * absent. Font settings use this for their "Default" option.
 */
function setVar(root: HTMLElement, name: string, value: string) {
  if (value === '') root.style.removeProperty(name);
  else root.style.setProperty(name, value);
}

/**
 * Pushes every setting declaring a `cssVar` or `domAttr` binding onto the
 * document root. This is the whole implementation for most appearance settings:
 * the stylesheets consume `--editor-font-size`, `--editor-measure` and friends,
 * so nothing downstream has to know a setting exists.
 */
export function useSettingsDomBindings() {
  const [global, workspace] = useSettingsStore(
    useShallow((s) => [s.global, s.workspace] as const),
  );

  useEffect(() => {
    const root = document.documentElement;

    for (const key of settingKeys) {
      const { cssVar, cssVars, domAttr } = settingsRegistry[key];
      if (!cssVar && !cssVars && !domAttr) continue;

      const value = resolveSetting(key, global, workspace);
      if (cssVar) setVar(root, cssVar.name, render(cssVar, value));
      if (cssVars) {
        const expand = cssVars as (v: unknown) => Record<string, string>;
        for (const [name, css] of Object.entries(expand(value))) {
          setVar(root, name, css);
        }
      }
      if (domAttr) root.setAttribute(domAttr.name, render(domAttr, value));
    }
  }, [global, workspace]);
}
