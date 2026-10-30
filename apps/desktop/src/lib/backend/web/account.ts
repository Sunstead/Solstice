/** Who's signed in to the web app, and signing out. */
import { apiJson } from './api';

export { signOut } from './api';

export function me(): Promise<{ username: string }> {
  return apiJson<{ username: string }>('/v1/me');
}

/** Where the server says its source is (the AGPL asks it be offered to users). */
export async function serverSource(): Promise<string | undefined> {
  const { source } = await apiJson<{ source?: string }>('/v1/info');
  return source && /^https?:\/\//.test(source) ? source : undefined;
}
