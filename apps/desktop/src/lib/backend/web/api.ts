/**
 * Calls to the Solstice Sync server the web app is served from. Same
 * origin, so the session cookie rides along; every change carries
 * `X-Solstice-Request`, which the server requires of cookie requests. A 401
 * means the session ended: back through sign-in, to this same page.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function signIn(): never {
  const here = location.pathname + location.search;
  location.assign(`/auth/login?return_to=${encodeURIComponent(here)}`);
  throw new ApiError(401, 'unauthorized', 'Signing in again');
}

export async function signOut() {
  const { redirect } = await apiJson<{ redirect?: string }>('/auth/logout', { method: 'POST' });
  location.assign(redirect || '/');
}

type Init = Omit<RequestInit, 'body'> & { body?: BodyInit | null; json?: unknown };

/** The raw response, once it's known to be a success. */
export async function api(path: string, init: Init = {}): Promise<Response> {
  const method = init.method ?? 'GET';
  const headers = new Headers(init.headers);
  if (method !== 'GET' && method !== 'HEAD') headers.set('X-Solstice-Request', '1');
  let body = init.body;
  if (init.json !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(init.json);
  }
  const res = await fetch(path, { ...init, method, headers, body, credentials: 'same-origin' });
  if (res.status === 401) signIn();
  if (!res.ok) {
    let code = 'error';
    let message = res.statusText || `HTTP ${res.status}`;
    try {
      const err = (await res.json()) as { code?: string; message?: string };
      code = err.code ?? code;
      message = err.message ?? message;
    } catch {
      // Not JSON: keep the status text.
    }
    throw new ApiError(res.status, code, message);
  }
  return res;
}

export async function apiJson<T>(path: string, init: Init = {}): Promise<T> {
  const res = await api(path, init);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** A vault path as URL segments, each one encoded. */
export function encodePath(rel: string): string {
  return rel.split('/').map(encodeURIComponent).join('/');
}

/** What a failed call says, for a command's error string. */
export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
