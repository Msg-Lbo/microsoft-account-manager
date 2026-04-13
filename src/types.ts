export interface AccountItem {
  id: number;
  account: string;
  password: string;
  clientId: string | null;
  refreshToken: string | null;
  remark: string | null;
  createdAt: string;
  syncStatus: string;
  syncMessage: string | null;
  refreshedAt: string | null;
  fetchedAt: string | null;
  fetchedCount: number;
}

export interface AccountPayload {
  account: string;
  password: string;
  clientId?: string;
  refreshToken?: string;
  remark?: string;
}

export interface ImportResult {
  inserted: number;
  skipped: number;
  errors: Array<{ line: number; raw: string; reason: string }>;
}

export interface IngestConfig {
  delimiter: string;
  captchaField: string;
  accountField: string;
  passwordField: string;
  clientIdField: string;
  tokenField: string;
}

export type MailFetchMode = 'graph' | 'imap';

export interface BatchActionDetail {
  id: number;
  account: string;
  ok: boolean;
  message: string;
  fetchedCount?: number;
}

export interface BatchActionResult {
  total: number;
  success: number;
  failure: number;
  details: BatchActionDetail[];
}

export interface AccountMailItem {
  id: string;
  subject: string;
  from: string;
  receivedAt: string;
  preview: string;
  contentType: string;
  content: string;
}

export interface AccountAliasItem {
  id: number;
  accountId: number;
  account: string;
  aliasEmail: string;
  aliasSuffix: string;
  remark: string | null;
  isRegistered: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuthUser {
  username: string;
}
