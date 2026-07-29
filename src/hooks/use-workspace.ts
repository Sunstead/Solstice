import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { touchKnownWorkspace } from '@/lib/stores/known-workspaces';
import { useRouter } from '@tanstack/react-router';

export function useWorkspace() {
  const [path, setPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const router = useRouter();

  useEffect(() => {
    invoke<string | null>('get_workspace').then((p) => {
      setPath(p);
      setLoading(false);
    });
  }, []);

  async function openFolder() {
    const picked = await open({ directory: true });
    if (typeof picked === 'string') {
      await invoke('set_workspace', { path: picked });
      await touchKnownWorkspace(picked);
      router.invalidate();
      setPath(picked);
    }
  }

  return { path, loading, openFolder, setPath };
}
