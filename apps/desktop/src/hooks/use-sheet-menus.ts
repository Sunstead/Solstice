import { useIsMobile } from '@sunstead/ui/hooks/use-mobile';
import { touchFirst } from '@/lib/backend/platform';

/**
 * Whether menus here are bottom sheets: on a touch screen (iPhone and iPad
 * alike) and in a phone-width window, as the file rows' hold sheets are.
 */
export function useSheetMenus(): boolean {
  return useIsMobile() || touchFirst;
}
