import type { ComponentType, ReactNode } from 'react';

import type { EntryMenuItem } from '@/lib/entry-menu-items';

/**
 * The primitive set a surface renders with. Both Base UI menu families expose
 * the same shape, which is what makes one item list serviceable for both.
 */
export type EntryMenuComponents = {
  Item: ComponentType<{
    variant?: 'default' | 'destructive';
    disabled?: boolean;
    onClick?: () => void;
    children?: ReactNode;
  }>;
  Separator: ComponentType<{ className?: string }>;
  Sub: ComponentType<{ children?: ReactNode }>;
  SubTrigger: ComponentType<{ children?: ReactNode, className?: string }>;
  SubContent: ComponentType<{ children?: ReactNode }>;
};

export function EntryMenuItems({
  items,
  components,
}: {
  items: EntryMenuItem[];
  components: EntryMenuComponents;
}) {
  const { Item, Separator, Sub, SubTrigger, SubContent } = components;

  return (
    <>
      {items.map((item) => {
        if (item.kind === 'separator') {
          return <Separator key={item.id} />;
        }

        if (item.kind === 'submenu') {
          const Icon = item.icon;
          return (
            <Sub key={item.id}>
              <SubTrigger className="gap-2">
                <Icon /> {item.label}
              </SubTrigger>
              <SubContent>
                <EntryMenuItems items={item.items} components={components} />
              </SubContent>
            </Sub>
          );
        }

        const Icon = item.icon;

        return (
          <Item
            key={item.id}
            variant={item.destructive ? 'destructive' : 'default'}
            disabled={item.disabled}
            onClick={item.run}
          >
            <Icon /> {item.label}
          </Item>
        );
      })}
    </>
  );
}
