import { useEffect, useState } from 'react';
import { shell } from '@/lib/backend/platform';
import { openUrl } from '@/lib/backend/shell';
import { serverSource } from '@/lib/backend/web/account';

const UPSTREAM = 'https://github.com/Sunstead/Solstice';

/** Solstice is AGPL; this is where its source is. On the web, the server's own say. */
export function SourceLink() {
  const [href, setHref] = useState(UPSTREAM);

  useEffect(() => {
    if (shell !== 'web') return;
    void serverSource()
      .then((source) => source && setHref(source))
      .catch(() => {});
  }, []);

  return (
    <button
      type='button'
      className='w-fit text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground'
      onClick={() => void openUrl(href)}
    >
      Source code (AGPL-3.0)
    </button>
  );
}
