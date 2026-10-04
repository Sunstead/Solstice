import { useEffect, type CSSProperties } from 'react';
import { AlertTriangle, Check, FolderOpen, RefreshCw } from 'lucide-react';
import { revealItemInDir } from '@/lib/backend/shell';

import { Button } from '@sunstead/ui/components/button';
import { cn } from '@/lib/utils';
import { commands } from '@/lib/backend';
import { setSetting, useSetting } from '@/lib/settings/store';
import { hasOpenWorkspace } from '@/lib/stores/scoped-storage';
import { DEFAULT_LIGHT_THEME_ID, DEFAULT_THEME_ID } from '@/lib/theme/builtin';
import { SWATCH_TOKENS } from '@/lib/theme/tokens';
import { useThemeCatalogue } from '@/lib/theme/store';
import type { CatalogueTheme } from '@/lib/theme/types';
import { SettingList } from './setting-list';
import { SettingsPane } from './settings-pane';

/**
 * A theme's own colors, without applying it: the strip carries the theme's
 * `data-theme` (a built-in, or the one a user theme sits on) plus any user
 * variables, so `var()` inside it resolves to that theme's values.
 */
function Swatches({ theme }: { theme: CatalogueTheme }) {
  const base =
    theme.source === 'builtin'
      ? theme.id
      : theme.appearance === 'light'
        ? DEFAULT_LIGHT_THEME_ID
        : DEFAULT_THEME_ID;
  return (
    <div
      data-theme={base}
      className='flex h-12 overflow-hidden rounded-md ring-1 ring-foreground/10'
      style={{ ...theme.vars, backgroundColor: 'var(--background)' } as CSSProperties}
    >
      {SWATCH_TOKENS.map((token) => (
        <div
          key={token}
          className='flex-1'
          style={{ backgroundColor: `var(${token})` }}
        />
      ))}
    </div>
  );
}

function ThemeCard({
  theme,
  selected,
  onSelect,
}: {
  theme: CatalogueTheme;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type='button'
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'group flex flex-col gap-2 rounded-lg border p-2 text-left transition-colors',
        selected
          ? 'border-primary/60 bg-foreground/3'
          : 'border-border/60 hover:bg-foreground/2',
      )}
    >
      <Swatches theme={theme} />
      <div className='flex items-baseline gap-1.5'>
        <span className='truncate text-sm font-medium'>{theme.name}</span>
        {selected && <Check className='size-3.5 shrink-0 text-primary' />}
      </div>
      <div className='flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground'>
        <span className='capitalize'>{theme.appearance}</span>
        {theme.source !== 'builtin' && (
          <span className='rounded-sm bg-muted px-1 py-px capitalize'>
            {theme.source}
          </span>
        )}
        {theme.author && <span className='truncate'>· {theme.author}</span>}
      </div>
    </button>
  );
}

/** The theme keys this pane renders its own controls for, not `SettingsPane`'s. */
const THEME_KEYS = ['theme.mode', 'theme.preset', 'theme.lightPreset', 'theme.darkPreset'] as const;

/**
 * The custom pane for the merged "Appearance" section: a theme grid above the
 * generic rows. Themes are picked by looking at them, which a list of radio
 * labels cannot support — everything else in the section (the mode toggle,
 * and the leftover viewer/canvas toggles below) is ordinary generated UI.
 */
export function ThemePane() {
  const themes = useThemeCatalogue((s) => s.themes);
  const issues = useThemeCatalogue((s) => s.issues);
  const loading = useThemeCatalogue((s) => s.loading);
  const reload = useThemeCatalogue((s) => s.reload);

  const mode = useSetting('theme.mode');
  const preset = useSetting('theme.preset');
  const lightPreset = useSetting('theme.lightPreset');
  const darkPreset = useSetting('theme.darkPreset');

  // Picks up theme files added while the app was already running, without
  // making the user find the reload button first.
  useEffect(() => {
    void reload();
  }, [reload]);

  /**
   * In `system` mode a card fills whichever slot matches its own appearance,
   * so clicking a light theme sets the light slot rather than switching the
   * app out of following the system.
   */
  const select = (theme: CatalogueTheme) => {
    if (mode === 'fixed') return setSetting('theme.preset', theme.id);
    const key = theme.appearance === 'light' ? 'theme.lightPreset' : 'theme.darkPreset';
    setSetting(key, theme.id);
  };

  const isSelected = (theme: CatalogueTheme) =>
    mode === 'fixed'
      ? theme.id === preset
      : theme.id === (theme.appearance === 'light' ? lightPreset : darkPreset);

  const openFolder = async (scope: 'workspace' | 'global') => {
    const result = await commands.ensureThemeDir(scope);
    if (result.status === 'error') {
      console.error('Could not open the themes folder:', result.error);
      return;
    }
    await revealItemInDir(result.data);
  };

  return (
    <div className='flex flex-col gap-6'>
      {/*
        * Only the mode row: the three preset keys are settings like any other,
        * but the grid below is their control, and rendering both would put two
        * pickers for one value on the same screen. They still appear as
        * comboboxes in settings search, which has no grid to offer.
        */}
      <SettingList keys={['theme.mode']} />

      <section>
        <div className='flex items-center justify-between pb-2'>
          <h3 className='text-xs font-medium text-muted-foreground'>
            {mode === 'fixed' ? 'Presets' : 'Presets for each appearance'}
          </h3>
          <Button
            variant='ghost'
            size='sm'
            className='h-7 text-xs text-muted-foreground'
            onClick={() => void reload()}
            disabled={loading}
          >
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
            Reload
          </Button>
        </div>

        {(['dark', 'light'] as const).map((appearance) => (
          <div key={appearance} className='pb-4 last:pb-0'>
            <h4 className='pb-1.5 text-[0.6875rem] text-muted-foreground'>
              {appearance === 'dark' ? 'Dark' : 'Light'}
            </h4>
            <div className='grid grid-cols-2 gap-2 lg:grid-cols-3'>
              {themes
                .filter((theme) => theme.appearance === appearance)
                .map((theme) => (
                  <ThemeCard
                    key={theme.id}
                    theme={theme}
                    selected={isSelected(theme)}
                    onSelect={() => select(theme)}
                  />
                ))}
            </div>
          </div>
        ))}
      </section>

      {issues.length > 0 && (
        <section className='rounded-lg border border-destructive/40 bg-destructive/5 p-3'>
          <h3 className='flex items-center gap-1.5 text-xs font-medium text-destructive'>
            <AlertTriangle className='size-3.5' />
            {issues.length === 1
              ? 'A theme file could not be loaded'
              : `${issues.length} theme files could not be loaded`}
          </h3>
          <ul className='mt-1.5 space-y-1 text-xs text-muted-foreground'>
            {issues.map((issue) => (
              <li key={issue.path}>
                <span className='font-medium'>
                  {issue.path.split(/[\\/]/).pop()}
                </span>
                {' — '}
                {issue.reason}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3 className='pb-1 text-xs font-medium text-muted-foreground'>
          Custom themes
        </h3>
        <p className='pb-2 text-xs text-muted-foreground'>
          Drop a <code className='rounded bg-muted px-1 py-px'>.json</code> file
          into a themes folder to add it to the list. A theme may set the app's
          color variables and nothing else; anything else in the file is
          ignored.
        </p>
        <div className='flex gap-2'>
          <Button
            variant='outline'
            size='sm'
            className='h-7 text-xs'
            onClick={() => void openFolder('global')}
          >
            <FolderOpen className='size-3.5' />
            App themes
          </Button>
          <Button
            variant='outline'
            size='sm'
            className='h-7 text-xs'
            disabled={!hasOpenWorkspace()}
            onClick={() => void openFolder('workspace')}
          >
            <FolderOpen className='size-3.5' />
            Workspace themes
          </Button>
        </div>
      </section>

      {/*
        * Everything else this section owns -- the "File viewers" and "Canvas"
        * groups -- rendered as ordinary settings below the theme controls.
        * `excludeKeys` keeps the theme keys above from appearing twice.
        */}
      <SettingsPane section='appearance' excludeKeys={THEME_KEYS} />
    </div>
  );
}
