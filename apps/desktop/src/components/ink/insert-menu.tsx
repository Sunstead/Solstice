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
 * Solstice's own menu, in place of Apple's.
 */
export function InsertMenu({ surface }: { surface: MarkupSurface }) {
  const items = insertItems(surface);
  const pageItems = items.filter((i) => i.id === 'addPage' || i.id === 'pages');
  const markItems = items.filter((i) => !pageItems.includes(i));

  const choose = (item: InsertItem) => {
    if (item.id === 'pages') useInkUi.setState({ pages: true });
    else void nativeInk.insert(item.id);
  };

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
