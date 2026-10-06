import { UserRound } from 'lucide-react';

import { Avatar, AvatarBadge, AvatarFallback } from '@sunstead/ui/components/avatar';
import { initials } from '@/lib/initials';
import { cn } from '@/lib/utils';

/**
 * Who's signed in, at a glance: initials on a neutral disc that follows the
 * theme (as in Cosmos), or a muted person when nobody is. `attention` adds a
 * dot for something waiting on you, like a sync that needs signing in again.
 */
export function UserAvatar({
  username,
  attention,
  size = 'default',
  className,
}: {
  username: string | null;
  attention?: boolean;
  size?: 'sm' | 'default' | 'lg';
  className?: string;
}) {
  return (
    <Avatar size={size} className={cn('ring-1 ring-sidebar-border', className)}>
      <AvatarFallback
        className={cn(
          'font-medium select-none',
          size === 'lg' ? 'text-sm' : size === 'sm' ? 'text-[10px]' : 'text-xs',
          username && 'bg-sidebar-accent text-sidebar-accent-foreground',
        )}
      >
        {username ? initials(username) : <UserRound className={size === 'lg' ? 'size-5' : 'size-4'} />}
      </AvatarFallback>
      {attention && <AvatarBadge className='bg-warning' />}
    </Avatar>
  );
}
