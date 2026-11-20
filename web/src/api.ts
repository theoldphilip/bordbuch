const TOKEN_KEY = 'bordbuch.token';

export class ApiError extends Error {
  status: number;
  issues: { path: string; message: string }[];
  constructor(status: number, message: string, issues: { path: string; message: string }[] = []) {
    super(message);
    this.status = status;
    this.issues = issues;
  }
}

let onUnauthorized: () => void = () => {};
let onOffline: (offline: boolean) => void = () => {};

export const api = {
  get token(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  setToken(token: string | null) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* private mode */
    }
  },
  onUnauthorized(fn: () => void) {
    onUnauthorized = fn;
  },
  onOffline(fn: (offline: boolean) => void) {
    onOffline = fn;
  },

  async raw(method: string, path: string, body?: unknown, init: RequestInit = {}): Promise<Response> {
    const headers: Record<string, string> = {};
    const token = api.token;
    if (token) headers.Authorization = `Bearer ${token}`;
    let payload: BodyInit | undefined;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    let res: Response;
    try {
      res = await fetch(path, { method, headers, body: payload, ...init });
    } catch {
      onOffline(true);
      throw new ApiError(0, 'Server nicht erreichbar – bist du mit dem VPN verbunden?');
    }
    onOffline(res.headers.get('X-Bordbuch-Offline') === '1');
    if (res.status === 401 && token) onUnauthorized();
    if (!res.ok) {
      let data: { error?: string; issues?: { path: string; message: string }[] } = {};
      try {
        data = await res.json();
      } catch {
        /* not json */
      }
      throw new ApiError(res.status, data.error ?? `Fehler ${res.status}`, data.issues);
    }
    return res;
  },

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await api.raw(method, path, body);
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  },

  get: <T,>(path: string) => api.request<T>('GET', path),
  post: <T,>(path: string, body?: unknown) => api.request<T>('POST', path, body),
  put: <T,>(path: string, body?: unknown) => api.request<T>('PUT', path, body),
  patch: <T,>(path: string, body?: unknown) => api.request<T>('PATCH', path, body),
  del: (path: string) => api.request<void>('DELETE', path),

  /** Opens an attachment (auth via header, so we go through a blob URL). */
  async openAttachment(id: string, filename: string, download = false) {
    // Open the window synchronously so iOS Safari doesn't block it as a popup.
    const win = download ? null : window.open('', '_blank');
    try {
      const res = await api.raw('GET', `/api/attachments/${id}`);
      const url = URL.createObjectURL(await res.blob());
      if (win) win.location.href = url;
      else {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      win?.close();
      throw err;
    }
  },
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.issues.length) return `${err.message}: ${err.issues.map((i) => i.message).join(', ')}`;
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}
