import type { ComponentType, ReactNode } from 'react';

/**
 * One choice in a menu, as data, so the same menu can be a dropdown at the
 * pointer or a bottom sheet (`ActionMenu`). One with `items` opens them in
 * its place; one with `content` is a row of its own (a colour picker).
 */
export type Action = {
  id: string;
  label: string;
  icon?: ComponentType<{ className?: string }>;
  destructive?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
  items?: Action[];
  content?: ReactNode;
};
