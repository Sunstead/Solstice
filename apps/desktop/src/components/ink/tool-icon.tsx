import {
  Brush,
  Eraser,
  Feather,
  Highlighter,
  Lasso,
  Paintbrush,
  Pen,
  PenLine,
  PenTool,
  Pencil,
  type LucideIcon,
} from 'lucide-react';

import type { ToolKind } from '@/lib/ink/toolbox';

const ICONS: Record<ToolKind, LucideIcon> = {
  pen: Pen,
  monoline: PenLine,
  fountainPen: PenTool,
  marker: Highlighter,
  pencil: Pencil,
  crayon: Brush,
  watercolor: Paintbrush,
  reed: Feather,
  eraser: Eraser,
  lasso: Lasso,
};

export function ToolIcon({ kind, className }: { kind: ToolKind; className?: string }) {
  const Icon = ICONS[kind];
  return <Icon className={className} aria-hidden />;
}
