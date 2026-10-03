import { useEffect } from 'react';
import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { message } from '@tauri-apps/plugin-dialog';
import { commands } from '@/bindings';
import { useLayout } from '@/hooks/use-layout';
import { useWorkspace } from '@/hooks/use-workspace';
import { folderName, parseDeepLink, workspacesForVault } from '@/lib/deep-link';
import { useKnownWorkspaces } from '@/lib/stores/known-workspaces';
import { basename, joinWorkspacePath } from '@/lib/wikilink/target';

async function warn(text: string) {
  await message(text, { title: "Can't open link", kind: 'warning' });
}

async function openDeepLink(raw: string) {
  const link = parseDeepLink(raw);
  if (!link) {
    await warn('That link is not a Solstice note link.');
    return;
  }

  // The open workspace wins when it matches, so a link never switches away
  // from the vault being worked in.
  const current = useWorkspace.getState().path;
  let root = current && folderName(current).toLowerCase() === link.vault.toLowerCase() ? current : null;
  if (!root) {
    const [match] = workspacesForVault(link.vault, useKnownWorkspaces.getState().workspaces);
    if (!match) {
      await warn(`Open the "${link.vault}" folder in Solstice once, then try the link again.`);
      return;
    }
    root = match.path;
    await useWorkspace.getState().setWorkspace(root);
  }

  const fullPath = joinWorkspacePath(root, link.path);
  if (!(await commands.exists(fullPath))) {
    await warn(`"${link.path}" isn't in ${link.vault}.`);
    return;
  }
  useLayout.getState().openFile(fullPath, basename(link.path));
}

// The link that launched the app is handled once, not again each time a
// workspace switch makes the layout ready anew.
let launchHandled = false;

/**
 * Opens `solstice://` links: the one that launched the app, once the
 * workspace has loaded, and any that arrive while it runs.
 */
export function useDeepLinks() {
  // Ready once the workspace (if any) has its layout, so the first link has
  // somewhere to open its tab.
  const noWorkspace = useWorkspace((s) => !s.loading && s.path === null);
  const hasLayout = useLayout((s) => s.model !== null);
  const ready = noWorkspace || hasLayout;

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    if (!launchHandled) {
      launchHandled = true;
      void getCurrent()
        .then(async (urls) => {
          for (const url of urls ?? []) await openDeepLink(url);
        })
        .catch((error) => console.error('Deep links:', error));
    }

    void onOpenUrl((urls) => {
      void (async () => {
        for (const url of urls) await openDeepLink(url);
      })();
    })
      .then((stop) => {
        if (cancelled) stop();
        else unlisten = stop;
      })
      .catch((error) => console.error('Deep links:', error));

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [ready]);
}
