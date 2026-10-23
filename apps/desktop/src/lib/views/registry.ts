import { Bookmark, Files, Search } from 'lucide-react';
import { BookmarksSidebar } from '@/components/bookmarks/bookmarks-sidebar';
import { ExplorerSidebar } from '@/components/explorer-sidebar';
import { SearchSidebar } from '@/components/search/search-sidebar';
import type { PrimaryView } from './types';

export const primaryViews: PrimaryView[] = [
  {
    id: 'explorer',
    icon: Files,
    label: 'Explorer',
    sidebarComponent: ExplorerSidebar,
  },
  {
    id: 'bookmarks',
    icon: Bookmark,
    label: 'Bookmarks',
    sidebarComponent: BookmarksSidebar,
  },
  {
    id: 'search',
    icon: Search,
    label: 'Search',
    sidebarComponent: SearchSidebar,
  },
];
