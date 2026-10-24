import type { ApiError, AuthResponse, RegisterStartResponse } from '@thegrave/shared';
import { useAuth } from '../stores/auth';

export class ApiRequestError extends Error {
  readonly status: number;
  readonly body: ApiError;

  constructor(status: number, body: ApiError) {
    super(body.message);
    this.status = status;
    this.body = body;
  }
}

async function parse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({ error: res.statusText, message: res.statusText }));
  if (!res.ok) throw new ApiRequestError(res.status, body as ApiError);
  return body as T;
}

let inFlight: Promise<boolean> | null = null;

/**
 * Exchanges the httpOnly refresh cookie for a new access token. Calls are deduplicated within a tab,
 * and serialised across tabs with a Web Lock: refresh tokens rotate and reuse revokes the family,
 * so two tabs must never present the same cookie at once (decision.md D-020).
 */
export function refreshSession(): Promise<boolean> {
  inFlight ??= navigator.locks
    .request('thegrave-refresh', async () => {
      const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' });
      if (!res.ok) return false;
      useAuth.getState().setSession((await res.json()) as AuthResponse);
      return true;
    })
    .catch(() => false)
    .then((ok) => {
      if (!ok) useAuth.getState().clear();
      return ok;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** fetch wrapper: attaches the access token, and on a 401 refreshes once and retries. */
export async function api<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { json, ...rest } = init;
  const send = () => {
    const headers = new Headers(rest.headers);
    const token = useAuth.getState().accessToken;
    if (token) headers.set('Authorization', `Bearer ${token}`);
    if (json !== undefined) headers.set('Content-Type', 'application/json');
    return fetch(`/api${path}`, {
      ...rest,
      headers,
      credentials: 'same-origin',
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  };

  let res = await send();
  if (res.status === 401 && !path.startsWith('/auth/') && (await refreshSession()))
    res = await send();
  return parse<T>(res);
}

export const authApi = {
  // Registration is two steps: an emailed code, then the account (decision.md D-076).
  register: (json: unknown) =>
    api<RegisterStartResponse>('/auth/register', { method: 'POST', json }),
  verifyEmail: (json: unknown) =>
    api<AuthResponse>('/auth/register/verify', { method: 'POST', json }),
  resendCode: (json: unknown) =>
    api<RegisterStartResponse>('/auth/register/resend', { method: 'POST', json }),
  login: (json: unknown) => api<AuthResponse>('/auth/login', { method: 'POST', json }),
  logout: () => api<void>('/auth/logout', { method: 'POST' }),
};
