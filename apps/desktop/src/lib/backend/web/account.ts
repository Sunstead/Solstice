/** Who's signed in to the web app, and signing out. */
import { apiJson } from './api';

export { signOut } from './api';

export function me(): Promise<{ username: string }> {
  return apiJson<{ username: string }>('/v1/me');
}
