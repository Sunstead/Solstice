import { useState } from 'react';
import {
  ArrowBigRight,
  Circle,
  FilePlus,
  Hexagon,
  ImagePlus,
  LayoutGrid,
  MessageSquare,
  Minus,
  MoveUpRight,
  Plus,
  Search,
  Square,
  SquareRoundCorner,
  Star,
  Type,
  type LucideIcon,
} from 'lucide-react';

import { Button } from '@sunstead/ui/components/button';
import { ActionSheet, type Action } from '@/components/ui/action-sheet';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@sunstead/ui/components/dropdown-menu';
import { nativeInk } from '@/lib/backend/native';
import { touchFirst } from '@/lib/backend/platform';
import { insertItems, type InsertItem, type InsertShape, type MarkupSurface } from '@/lib/ink/insert';
import { useInkUi } from '@/lib/stores/ink-tools';

const ICONS: Record<InsertItem['id'], LucideIcon> = {
  text: Type,
  shape: Square,
  line: Minus,
  arrow: MoveUpRight,
  loupe: Search,
  image: ImagePlus,
  addPage: FilePlus,
  pages: LayoutGrid,
};

const SHAPE_ICONS: Record<InsertShape, LucideIcon> = {
  rectangle: Square,
  roundedRectangle: SquareRoundCorner,
  ellipse: Circle,
  star: Star,
  regularPolygon: Hexagon,
  chatBubble: MessageSquare,
  arrowShape: ArrowBigRight,
};

/**
 * The ink ribbon's +: text, shapes, lines, a loupe or an image into the
 * canvas in view (`MarkupInsert`), and in a PDF, a new page or the page sheet.
 * Solstice's own menu, in place of Apple's; a sheet on a touch screen.
 */
export function InsertMenu({
  surface,
  className,
  extra = [],
}: {
  surface: MarkupSurface;
  className?: string;
  /** More rows for the sheet, after the rest (the phone's ruler). */
  extra?: Action[];
}) {
  const items = insertItems(surface);
  const pageItems = items.filter((i) => i.id === 'addPage' || i.id === 'pages');
  const markItems = items.filter((i) => !pageItems.includes(i));

  const choose = (item: InsertItem) => {
    if (item.id === 'pages') useInkUi.setState({ pages: true });
    else void nativeInk.insert(item.id);
  };

  if (touchFirst)
    return <InsertSheet marks={markItems} pages={pageItems} extra={extra} choose={choose} className={className} />;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant='ghost' size='icon-sm' title='Insert' />}>
        <Plus />
        <span className='sr-only'>Insert</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent className='w-auto min-w-48' align='end'>
        {markItems.map((item) => {
          const Icon = ICONS[item.id];
          if (item.shapes) {
            return (
              <DropdownMenuSub key={item.id}>
                <DropdownMenuSubTrigger>
                  <Icon />
                  {item.label}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {item.shapes.map(({ shape, label }) => {
                    const ShapeIcon = SHAPE_ICONS[shape];
                    return (
                      <DropdownMenuItem key={shape} onClick={() => void nativeInk.insert('shape', shape)}>
                        <ShapeIcon />
                        {label}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            );
          }
          return (
            <DropdownMenuItem key={item.id} onClick={() => choose(item)}>
              <Icon />
              {item.label}
            </DropdownMenuItem>
          );
        })}
        {pageItems.length > 0 && <DropdownMenuSeparator />}
        {pageItems.map((item) => {
          const Icon = ICONS[item.id];
          return (
            <DropdownMenuItem key={item.id} onClick={() => choose(item)}>
              <Icon />
              {item.label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function InsertSheet({
  marks,
  pages,
  extra,
  choose,
  className,
}: {
  marks: InsertItem[];
  pages: InsertItem[];
  extra: Action[];
  choose: (item: InsertItem) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const action = (item: InsertItem): Action => ({
    id: item.id,
    label: item.label,
    icon: ICONS[item.id],
    onSelect: () => choose(item),
    items: item.shapes?.map(({ shape, label }) => ({
      id: shape,
      label,
      icon: SHAPE_ICONS[shape],
      onSelect: () => void nativeInk.insert('shape', shape),
    })),
  });
  return (
    <>
      <Button variant='ghost' size='icon-sm' className={className} title='Insert' onClick={() => setOpen(true)}>
        <Plus />
        <span className='sr-only'>Insert</span>
      </Button>
      <ActionSheet open={open} onOpenChange={setOpen} title='Insert' groups={[marks.map(action), pages.map(action), extra]} />
    </>
  );
}
