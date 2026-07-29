// src/routes/__root.tsx
import { createRootRoute, Outlet } from '@tanstack/react-router';
import { ThemeProvider } from '../components/theme-provider';

export const Route = createRootRoute({
  component: () => (
    <ThemeProvider defaultTheme='dark' storageKey='vite-ui-theme'>
      <Outlet />
    </ThemeProvider>
  ),
});
