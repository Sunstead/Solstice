import type * as React from 'react';
import type { LucideIcon } from 'lucide-react';

export interface PrimaryView {
  id: string;
  icon: LucideIcon;
  label: string;
  sidebarComponent: React.ComponentType;
}