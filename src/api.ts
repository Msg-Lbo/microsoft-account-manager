import type {
  AccountItem,
  AccountPayload,
  AuthUser,
  IngestConfig,
  ImportResult
} from './types';

interface ApiError {
  message?: string;
}

export class UnauthorizedError extends Error {
  constructor(message = '未登录或登录已过期') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(path, {
    ...init,
    headers,
    credentials: 'same-origin'
  });

  const payload = (await response.json().catch(() => ({}))) as T & ApiError;
  if (!response.ok) {
    const message = payload.message ?? `请求失败 (${response.status})`;
    if (response.status === 401) {
      throw new UnauthorizedError(message);
    }
    throw new Error(message);
  }

  return payload;
}

function buildQuery(keyword?: string): string {
  if (!keyword) {
    return '';
  }

  const params = new URLSearchParams({ keyword });
  return `?${params.toString()}`;
}

export const api = {
  login(payload: { username: string; password: string }): Promise<{ ok: true; username: string }> {
    return request<{ ok: true; username: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  getMe(): Promise<AuthUser> {
    return request<AuthUser>('/api/auth/me');
  },

  logout(): Promise<{ ok: true }> {
    return request<{ ok: true }>('/api/auth/logout', {
      method: 'POST'
    });
  },

  listAccounts(keyword?: string): Promise<{ items: AccountItem[] }> {
    return request<{ items: AccountItem[] }>(`/api/accounts${buildQuery(keyword)}`);
  },

  createAccount(payload: AccountPayload): Promise<{ item: AccountItem }> {
    return request<{ item: AccountItem }>('/api/accounts', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  updateAccount(id: number, payload: AccountPayload): Promise<{ item: AccountItem }> {
    return request<{ item: AccountItem }>(`/api/accounts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
  },

  deleteAccount(id: number): Promise<{ ok: true }> {
    return request<{ ok: true }>(`/api/accounts/${id}`, {
      method: 'DELETE'
    });
  },

  importAccounts(text: string): Promise<ImportResult> {
    return request<ImportResult>('/api/accounts/import', {
      method: 'POST',
      body: JSON.stringify({ text })
    });
  },

  getIngestConfig(): Promise<{ item: IngestConfig; endpointPath: string; tokenHeader: string }> {
    return request<{ item: IngestConfig; endpointPath: string; tokenHeader: string }>(
      '/api/ingest-config'
    );
  },

  updateIngestConfig(payload: IngestConfig): Promise<{ item: IngestConfig }> {
    return request<{ item: IngestConfig }>('/api/ingest-config', {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
  }
};
