import { useEffect, useState } from 'react';
import { appVersion } from '@/lib/backend/updater';

/** This build's version, once read; null until then, and in a browser. */
export function useAppVersion() {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    void appVersion().then(setVersion);
  }, []);
  return version;
}
