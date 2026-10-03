import { Files } from 'lucide-react';
import { ExplorerSidebar } from '@/components/explorer-sidebar';
import type { PrimaryView } from './types';

export const primaryViews: PrimaryView[] = [
  {
    id: 'explorer',
    icon: Files,
    label: 'Explorer',
    sidebarComponent: ExplorerSidebar,
  },
];
