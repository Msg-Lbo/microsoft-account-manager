import type {
  AccountAliasItem,
  AccountMailItem,
  AccountItem,
  AccountPayload,
  AuthUser,
  BatchActionResult,
  IngestConfig,
  ImportResult,
  MailFetchMode
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

  updateAccountRemark(id: number, remark: string): Promise<{ item: AccountItem }> {
    return request<{ item: AccountItem }>(`/api/accounts/${id}/remark`, {
      method: 'PATCH',
      body: JSON.stringify({ remark })
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
  },

  refreshAccounts(payload?: { accountIds?: number[] }): Promise<BatchActionResult> {
    return request<BatchActionResult>('/api/accounts/refresh', {
      method: 'POST',
      body: JSON.stringify(payload ?? {})
    });
  },

  batchDeleteAccounts(payload: { accountIds: number[] }): Promise<{
    total: number;
    deleted: number;
    skipped: number;
  }> {
    return request<{ total: number; deleted: number; skipped: number }>('/api/accounts/batch-delete', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  getAccountMessages(
    id: number,
    mode: MailFetchMode,
    alias?: string
  ): Promise<{ accountId: number; account: string; mode: MailFetchMode; messages: AccountMailItem[] }> {
    const params = new URLSearchParams({ mode });
    if (alias) {
      params.set('alias', alias);
    }
    return request<{ accountId: number; account: string; mode: MailFetchMode; messages: AccountMailItem[] }>(
      `/api/accounts/${id}/messages?${params.toString()}`
    );
  },

  listAccountAliases(id: number): Promise<{
    accountId: number;
    account: string;
    limit: number;
    items: AccountAliasItem[];
  }> {
    return request<{
      accountId: number;
      account: string;
      limit: number;
      items: AccountAliasItem[];
    }>(`/api/accounts/${id}/aliases`);
  },

  generateAccountAliases(
    id: number,
    payload?: { count?: number; fillToLimit?: boolean }
  ): Promise<{
    accountId: number;
    account: string;
    limit: number;
    created: AccountAliasItem[];
    items: AccountAliasItem[];
  }> {
    return request<{
      accountId: number;
      account: string;
      limit: number;
      created: AccountAliasItem[];
      items: AccountAliasItem[];
    }>(`/api/accounts/${id}/aliases/generate`, {
      method: 'POST',
      body: JSON.stringify(payload ?? {})
    });
  },

  createCustomAlias(
    id: number,
    payload: { suffix: string; fillToLimit?: boolean }
  ): Promise<{
    accountId: number;
    account: string;
    limit: number;
    created: AccountAliasItem[];
    items: AccountAliasItem[];
  }> {
    return request<{
      accountId: number;
      account: string;
      limit: number;
      created: AccountAliasItem[];
      items: AccountAliasItem[];
    }>(`/api/accounts/${id}/aliases/custom`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  updateAccountAlias(
    id: number,
    aliasId: number,
    payload: { remark?: string | null; isRegistered?: boolean }
  ): Promise<{ item: AccountAliasItem }> {
    return request<{ item: AccountAliasItem }>(`/api/accounts/${id}/aliases/${aliasId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });
  },

  openUpdateAccountRemark(id: number, remark: string): Promise<{
    ok: true;
    id: number;
    account: string;
    remark: string | null;
  }> {
    return request<{ ok: true; id: number; account: string; remark: string | null }>(
      `/api/open/accounts/${id}/remark`,
      {
        method: 'PATCH',
        body: JSON.stringify({ remark })
      }
    );
  },

  openListAccounts(keyword?: string): Promise<{ items: AccountItem[] }> {
    const query = keyword ? `?${new URLSearchParams({ keyword }).toString()}` : '';
    return request<{ items: AccountItem[] }>(`/api/open/accounts${query}`);
  },

  openListAliases(account: string): Promise<{
    accountId: number;
    account: string;
    limit: number;
    items: AccountAliasItem[];
  }> {
    const query = new URLSearchParams({ account }).toString();
    return request<{
      accountId: number;
      account: string;
      limit: number;
      items: AccountAliasItem[];
    }>(`/api/open/aliases?${query}`);
  },

  openUpdateAliasRemark(
    aliasEmail: string,
    payload: { remark?: string | null; isRegistered?: boolean }
  ): Promise<{
    ok: true;
    aliasEmail: string;
    isRegistered: boolean;
    remark: string | null;
    accountId: number;
  }> {
    const encodedAlias = encodeURIComponent(aliasEmail);
    return request<{
      ok: true;
      aliasEmail: string;
      isRegistered: boolean;
      remark: string | null;
      accountId: number;
    }>(`/api/open/aliases/${encodedAlias}/remark`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });
  }
};
