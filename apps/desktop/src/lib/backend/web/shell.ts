/**
 * The browser's stand-ins for what the desktop asks of the OS. Links open in
 * a new tab; a file picker hands back blob URLs that `importAttachment`
 * uploads; a vault file's URL is the server's route for it; `/open?vault=`
 * is the web's `solstice://open` link.
 */
import { knownVault, vaultUrl } from './vault';

export async function openUrl(url: string | URL): Promise<void> {
  window.open(String(url), '_blank', 'noopener,noreferrer');
}

/** "Open in its app": the file itself, in a new tab. */
export async function openPath(path: string): Promise<void> {
  window.open(assetUrl(path), '_blank', 'noopener,noreferrer');
}

/** There's no file manager to show it in. */
export async function revealItemInDir(): Promise<void> {}

export async function message(text: string, options?: string | { title?: string }): Promise<'Ok'> {
  const title = typeof options === 'string' ? options : options?.title;
  window.alert(title ? `${title}\n\n${text}` : text);
  return 'Ok';
}

/** The names of files picked here, by the blob URL handed back for each. */
const picked = new Map<string, string>();

export function attachmentName(blobUrl: string): string {
  return picked.get(blobUrl) ?? 'attachment';
}

interface OpenOptions {
  multiple?: boolean;
  directory?: boolean;
  filters?: { name: string; extensions: string[] }[];
}

/**
 * The file dialog. Folders can't be picked from a browser (vaults are the
 * workspaces), so that answers nothing; files come back as blob URLs.
 */
export function open(options: OpenOptions = {}): Promise<string | string[] | null> {
  if (options.directory) return Promise.resolve(null);
  return new Promise((done) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = !!options.multiple;
    const extensions = options.filters?.flatMap((f) => f.extensions) ?? [];
    if (extensions.length > 0 && !extensions.includes('*')) {
      input.accept = extensions.map((e) => `.${e}`).join(',');
    }
    input.onchange = () => {
      const urls = [...(input.files ?? [])].map((file) => {
        const url = URL.createObjectURL(file);
        picked.set(url, file.name);
        return url;
      });
      done(urls.length === 0 ? null : options.multiple ? urls : urls[0]);
    };
    input.oncancel = () => done(null);
    input.click();
  });
}

/** The OS, for shortcut labels: from the browser's own report. */
export function platform(): 'macos' | 'windows' | 'linux' | 'ios' | 'android' {
  const ua = navigator.userAgent;
  if (/iPhone|iPad/.test(ua)) return 'ios';
  if (/Mac/.test(ua)) return 'macos';
  if (/Android/.test(ua)) return 'android';
  if (/Win/.test(ua)) return 'windows';
  return 'linux';
}

/**
 * `/open?vault=&path=` as the `solstice://open` link it stands for, so the
 * same handler opens it. The address goes back to `/` once read.
 */
export async function getCurrent(): Promise<string[] | null> {
  if (location.pathname !== '/open') return null;
  const link = `solstice://open${location.search}`;
  history.replaceState(null, '', '/');
  return [link];
}

export async function onOpenUrl(): Promise<() => void> {
  return () => {};
}

/** A vault file's URL on the server (`/<vault>/<path>` → its files route). */
export function assetUrl(path: string): string {
  const [name, ...rest] = path.replace(/\\/g, '/').replace(/^\/+/, '').split('/');
  const vault = knownVault(name);
  return vault ? vaultUrl(vault, 'files', rest.join('/')) : '';
}
