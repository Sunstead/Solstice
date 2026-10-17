import type { CSSProperties } from 'react';
import { touchFirst } from '@/lib/backend/platform';

/**
 * For `SidebarProvider`: where touch leads, the icon rail is 72px, as wide as
 * Discord's server list; elsewhere sunstead-ui's 3rem.
 */
export const railStyle: CSSProperties | undefined = touchFirst
  ? ({ '--sidebar-width-icon': '4rem' } as CSSProperties)
  : undefined;
