import { useEffect, useState } from 'react';
import { inTauri } from '@/lib/backend';

export type Platform = 'macos' | 'windows' | 'linux' | 'ios' | 'android' | 'unknown';

let cachedPlatform: Platform | null = null;
let inFlight: Promise<Platform> | null = null;

async function resolvePlatform(): Promise<Platform> {
  if (cachedPlatform) return cachedPlatform;
  if (!inTauri) {
    cachedPlatform = 'unknown';
    return cachedPlatform;
  }
  if (!inFlight) {
    inFlight = import('@/lib/backend/shell').then(({ platform }) => {
      cachedPlatform = platform() as Platform;
      return cachedPlatform;
    });
  }
  return inFlight;
}

export function usePlatform(): Platform | null {
  const [platform, setPlatform] = useState<Platform | null>(cachedPlatform);

  useEffect(() => {
    if (cachedPlatform) return; // already resolved, nothing to do
    let cancelled = false;
    resolvePlatform().then((p) => {
      if (!cancelled) setPlatform(p);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return platform;
}

export function useIsMac(): boolean {
  return usePlatform() === 'macos';
}
