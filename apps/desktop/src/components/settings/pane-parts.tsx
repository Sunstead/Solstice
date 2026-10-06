/** A section heading, as the other panes write them. */
export function Heading({ children }: { children: React.ReactNode }) {
  return <h3 className='pb-2 text-xs font-medium text-muted-foreground'>{children}</h3>;
}

/** A bordered group of related rows. */
export function Card({ children }: { children: React.ReactNode }) {
  return <div className='flex flex-col gap-3 rounded-lg border p-4 text-sm'>{children}</div>;
}
