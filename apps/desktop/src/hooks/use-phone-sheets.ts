import { useIsMobile } from '@sunstead/ui/hooks/use-mobile';

import { touchFirst } from '@/lib/backend/platform';

/** Whether dialogs are a phone's sheets: a touch screen at phone width (`FormLayout`). */
export function usePhoneSheets() {
  return useIsMobile() && touchFirst;
}
