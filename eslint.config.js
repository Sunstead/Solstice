import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

// One config for the whole monorepo. Mirrors Atlas's and Cosmos's.
export default tseslint.config(
  {
    // Generated: tauri-specta (bindings.ts), TanStack Router (routeTree.gen.ts),
    // Tauri (gen/). Regenerate rather than edit.
    ignores: [
      '**/dist',
      '**/node_modules',
      '**/target',
      'apps/desktop/src/generated',
      'apps/desktop/src/bindings.ts',
      'apps/desktop/src/routeTree.gen.ts',
      'apps/desktop/src-tauri/gen',
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // `_`-prefixed bindings drop keys when destructuring a record.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['*.config.{js,ts}', 'apps/*/*.config.{js,ts}'],
    languageOptions: { globals: globals.node },
  },
  {
    // The desktop app predates linting. These React Compiler rules flag
    // existing patterns (state set in effects, refs read during render,
    // components made in render) that need care to change, so they warn
    // until each is fixed; new code should not add to them.
    files: ['apps/desktop/src/**'],
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/static-components': 'warn',
    },
  },
  {
    // Vendored shadcn primitives, listed last so these win. The shadcn CLI
    // regenerates them, so rewriting them for the React Compiler rules would
    // be undone by the next `shadcn add`.
    files: ['apps/desktop/src/components/ui/**'],
    rules: {
      'react-hooks/purity': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/refs': 'off',
      'react-refresh/only-export-components': 'off',
    },
  },
);
