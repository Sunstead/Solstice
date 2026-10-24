import { useSlashMenu } from '@/lib/slash';
import { CaretMenu } from './caret-menu';

/** The `/` menu, under the slash (or over it, near the bottom). */
export function SlashMenu() {
  const { items, index, at, choose } = useSlashMenu();
  if (!at || !choose || items.length === 0) return null;
  return (
    <CaretMenu
      label='Insert'
      at={at}
      items={items}
      index={index}
      itemKey={(item) => item.label}
      onHover={(i) => useSlashMenu.setState({ index: i })}
      onChoose={choose}
      render={(item) => (
        <>
          <item.icon className='size-4 shrink-0 text-muted-foreground' />
          {item.label}
        </>
      )}
    />
  );
}
