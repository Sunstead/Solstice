import { Files } from 'lucide-react';
import { NotesSidebar } from '@/components/notes-sidebar';
import type { PrimaryView } from './types';

export const primaryViews: PrimaryView[] = [
  {
    id: 'notes',
    icon: Files,
    label: 'Notes',
    sidebarComponent: NotesSidebar,
  },
];
