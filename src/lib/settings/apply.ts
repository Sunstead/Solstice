import { useEffect } from 'react';
import { useShallow } from 'zustand/shallow';
import { settingKeys, settingsRegistry } from './registry';
import { resolveSetting, useSettingsStore } from './store';

/**
 * Pushes every setting that declares a `cssVar` or `domAttr` binding onto the
 * document root. This is the whole implementation for most appearance
 * settings -- the stylesheets consume `--editor-font-size`,
 * `--editor-measure` and friends, so nothing downstream has to know a
 * setting exists.
 *
 * Mirrors how `useDevicePixelRatio` already maintains `--dpr`.
 */
export function useSettingsDomBindings() {
  // One subscription for both layers; `useShallow` keeps the effect from
  // re-running on unrelated store writes.
  const [global, workspace] = useSettingsStore(
    useShallow((s) => [s.global, s.workspace] as const),
  );

  useEffect(() => {
    const root = document.documentElement;

    for (const key of settingKeys) {
      const def = settingsRegistry[key];
      if (!def.cssVar && !def.domAttr) continue;

      const value = resolveSetting(key, global, workspace);

      if (def.cssVar) {
        const { name, format } = def.cssVar as {
          name: string;
          format?: (v: unknown) => string;
        };
        root.style.setProperty(name, format ? format(value) : String(value));
      }

      if (def.domAttr) {
        const { name, format } = def.domAttr as {
          name: string;
          format?: (v: unknown) => string;
        };
        root.setAttribute(name, format ? format(value) : String(value));
      }
    }
  }, [global, workspace]);
}
