import { createElement } from 'react';

import { getFileIconFor } from '@/assets/icons';
import { useWikilinkMenu } from '@/lib/wikilink/suggest-menu';
import { basename, basenameOffset, wikilinkLabel } from '@/lib/wikilink/target';
import { CaretMenu } from './caret-menu';

/** Files to link, under the `[[` being typed. */
export function WikilinkMenu() {
  const { items, index, at, choose } = useWikilinkMenu();
  if (!at || !choose || items.length === 0) return null;
  return (
    <CaretMenu
      label='Link to'
      at={at}
      items={items}
      index={index}
      width={300}
      itemKey={(path) => path}
      onHover={(i) => useWikilinkMenu.setState({ index: i })}
      onChoose={choose}
      render={(path) => <Suggestion path={path} />}
    />
  );
}

function Suggestion({ path }: { path: string }) {
  // No trailing `/`; empty at the root.
  const folder = path.slice(0, Math.max(0, basenameOffset(path) - 1));
  // A note goes by its name; anything else keeps its extension.
  const name = path.toLowerCase().endsWith('.md') ? wikilinkLabel(path) : basename(path);
  return (
    <>
      {createElement(getFileIconFor(basename(path)), { className: 'size-4 shrink-0 text-muted-foreground' })}
      <span className='min-w-0 truncate'>{name}</span>
      {folder && <span className='ml-auto min-w-0 shrink truncate text-xs text-muted-foreground'>{folder}</span>}
    </>
  );
}
