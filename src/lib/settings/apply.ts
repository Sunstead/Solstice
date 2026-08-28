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
      const { cssVar, domAttr } = settingsRegistry[key];
      if (!cssVar && !domAttr) continue;

      const value = resolveSetting(key, global, workspace);
      if (cssVar) root.style.setProperty(cssVar.name, render(cssVar, value));
      if (domAttr) root.setAttribute(domAttr.name, render(domAttr, value));
    }
  }, [global, workspace]);
}
