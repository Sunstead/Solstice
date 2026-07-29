import { FileText } from 'lucide-react';
import { NotesSidebar } from '@/components/notes-sidebar';
import type { PrimaryView } from './types';

export const primaryViews: PrimaryView[] = [
  {
    id: 'notes',
    icon: FileText,
    label: 'Notes',
    sidebarComponent: NotesSidebar,
  },
];
