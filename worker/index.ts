import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import type { Context } from 'hono';

type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
  ADMIN_USERNAME?: string;
  ADMIN_PASSWORD?: string;
  SESSION_SECRET?: string;
  INGEST_TOKEN?: string;
  MAIL_API_TOKEN?: string;
};

type Variables = {
  authUser: string;
};

type MailFetchMode = 'graph' | 'imap';

interface AccountRow {
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

interface AccountPayload {
  account: string;
  password: string;
  clientId?: string;
  refreshToken?: string;
  remark?: string;
}

interface IngestConfig {
  delimiter: string;
  captchaField: string;
  accountField: string;
  passwordField: string;
  clientIdField: string;
  tokenField: string;
}

interface SessionPayload {
  username: string;
  exp: number;
}

interface ParseErrorItem {
  line: number;
  raw: string;
  reason: string;
}

interface ParsedAccount {
  line: number;
  raw: string;
  payload: AccountPayload;
}

interface ParseIncomingResult {
  records: ParsedAccount[];
  errors: ParseErrorItem[];
}

interface BatchActionDetail {
  id: number;
  account: string;
  ok: boolean;
  message: string;
  fetchedCount?: number;
}

interface AccountMailItem {
  id: string;
  subject: string;
  from: string;
  receivedAt: string;
  preview: string;
  contentType: string;
  content: string;
}

interface FetchActionResult {
  ok: boolean;
  message: string;
  fetchedCount: number;
  messages: AccountMailItem[];
}

interface TokenExchangeResult {
  accessToken: string;
  refreshToken: string;
}

const SESSION_COOKIE_NAME = 'am_session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24;
const INGEST_TOKEN_HEADER = 'x-ingest-token';
const MAIL_API_TOKEN_HEADER = 'x-mail-api-token';
const INGEST_PATH = '/api/upload/ingest';
const OPEN_MESSAGES_PATH = '/api/open/messages';
const MICROSOFT_TOKEN_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token';
const GRAPH_MESSAGES_URL = 'https://graph.microsoft.com/v1.0/me/messages';
const OUTLOOK_MESSAGES_URL = 'https://outlook.office.com/api/v2.0/me/messages';
const GRAPH_SCOPE = 'https://graph.microsoft.com/.default';
const IMAP_SCOPE = 'https://outlook.office.com/IMAP.AccessAsUser.All offline_access';
const DEFAULT_REFRESH_CONCURRENCY = 8;
const MAIL_PAGE_SIZE = 100;

const DEFAULT_INGEST_CONFIG: IngestConfig = {
  delimiter: '----',
  captchaField: 'data',
  accountField: 'a',
  passwordField: 'p',
  clientIdField: 'c',
  tokenField: 't'
};

const ACCOUNT_SELECT_SQL = `
  SELECT
    id,
    account,
    password,
    client_id AS clientId,
    refresh_token AS refreshToken,
    remark,
    created_at AS createdAt,
    IFNULL(sync_status, 'idle') AS syncStatus,
    sync_message AS syncMessage,
    refreshed_at AS refreshedAt,
    fetched_at AS fetchedAt,
    IFNULL(fetched_count, 0) AS fetchedCount
  FROM accounts
`;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.use('/api/*', cors());

app.use('/api/*', async (c, next) => {
  if (c.req.method === 'OPTIONS') {
    await next();
    return;
  }

  const pathname = new URL(c.req.url).pathname;
  if (isPublicApiPath(pathname)) {
    await next();
    return;
  }

  const authUser = await authenticateRequest(c);
  if (!authUser) {
    throw new HTTPException(401, { message: '未登录或登录已过期' });
  }

  c.set('authUser', authUser);
  await next();
});

app.get('/api/health', (c) => c.json({ ok: true }));

app.post('/api/auth/login', async (c) => {
  const body = await readJson<{ username?: string; password?: string }>(c);
  const username = asText(body.username).trim();
  const password = asText(body.password);

  const expectedUsername = getConfiguredUsername(c.env);
  const expectedPassword = getConfiguredPassword(c.env);
  const sessionSecret = getSessionSecret(c.env);

  if (!username || !password) {
    throw new HTTPException(400, { message: '用户名和密码不能为空' });
  }

  if (username !== expectedUsername || !timingSafeEqual(password, expectedPassword)) {
    throw new HTTPException(401, { message: '用户名或密码错误' });
  }

  const token = await createSessionToken(expectedUsername, sessionSecret);
  setCookie(c, SESSION_COOKIE_NAME, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    secure: isHttpsRequest(c.req.url),
    maxAge: SESSION_MAX_AGE_SECONDS
  });

  return c.json({ ok: true as const, username: expectedUsername });
});

app.get('/api/auth/me', (c) => {
  return c.json({ username: c.get('authUser') });
});

app.post('/api/auth/logout', (c) => {
  deleteCookie(c, SESSION_COOKIE_NAME, {
    path: '/',
    sameSite: 'Lax',
    secure: isHttpsRequest(c.req.url)
  });
  return c.json({ ok: true as const });
});

app.get('/api/accounts', async (c) => {
  const keyword = (c.req.query('keyword') ?? '').trim();
  const items = await queryAccounts(c.env.DB, keyword);
  return c.json({ items });
});

app.get('/api/open/accounts', async (c) => {
  validateOpenApiToken(c, getMailApiToken(c.env));

  const keyword = (c.req.query('keyword') ?? '').trim();
  const items = await queryAccounts(c.env.DB, keyword);
  return c.json({ items });
});

app.post('/api/accounts', async (c) => {
  const body = await readJson<Partial<AccountPayload>>(c);
  const payload = normalizeAccountPayload(body, true);

  let insertResult: D1Result;
  try {
    insertResult = await c.env.DB
      .prepare(
        `INSERT INTO accounts (account, password, client_id, refresh_token, remark)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(
        payload.account,
        payload.password,
        payload.clientId,
        payload.refreshToken,
        payload.remark
      )
      .run();
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new HTTPException(409, { message: '账号记录已存在' });
    }
    throw error;
  }

  const lastRowId = Number(insertResult.meta.last_row_id);
  const item = await c.env.DB
    .prepare(`${ACCOUNT_SELECT_SQL} WHERE id = ?`)
    .bind(lastRowId)
    .first<AccountRow>();

  if (!item) {
    throw new HTTPException(500, { message: '账号创建成功，但读取结果失败' });
  }

  return c.json({ item }, 201);
});

app.put('/api/accounts/:id', async (c) => {
  const id = parseNumericId(c.req.param('id'));
  const body = await readJson<Partial<AccountPayload>>(c);
  const payload = normalizeAccountPayload(body, true);

  let result: D1Result;
  try {
    result = await c.env.DB
      .prepare(
        `UPDATE accounts
         SET account = ?, password = ?, client_id = ?, refresh_token = ?, remark = ?
         WHERE id = ?`
      )
      .bind(
        payload.account,
        payload.password,
        payload.clientId,
        payload.refreshToken,
        payload.remark,
        id
      )
      .run();
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new HTTPException(409, { message: '账号记录已存在' });
    }
    throw error;
  }

  if ((result.meta.changes ?? 0) === 0) {
    throw new HTTPException(404, { message: '账号不存在' });
  }

  const item = await c.env.DB
    .prepare(`${ACCOUNT_SELECT_SQL} WHERE id = ?`)
    .bind(id)
    .first<AccountRow>();

  if (!item) {
    throw new HTTPException(404, { message: '账号不存在' });
  }

  return c.json({ item });
});

app.delete('/api/accounts/:id', async (c) => {
  const id = parseNumericId(c.req.param('id'));
  const result = await c.env.DB.prepare('DELETE FROM accounts WHERE id = ?').bind(id).run();

  if ((result.meta.changes ?? 0) === 0) {
    throw new HTTPException(404, { message: '账号不存在' });
  }

  return c.json({ ok: true as const });
});

app.patch('/api/accounts/:id/remark', async (c) => {
  const id = parseNumericId(c.req.param('id'));
  const body = await readJson<{ remark?: unknown }>(c);
  const remark = normalizeRemark(body.remark);

  const item = await updateAccountRemark(c.env.DB, id, remark);
  if (!item) {
    throw new HTTPException(404, { message: '账号不存在' });
  }

  return c.json({ item });
});

app.post('/api/accounts/import', async (c) => {
  const body = await readJson<{ text?: string }>(c);
  const text = asText(body.text).trim();
  if (!text) {
    throw new HTTPException(400, { message: '导入内容不能为空' });
  }

  const lines = text.split(/\r?\n/);
  let inserted = 0;
  let skipped = 0;
  const errors: ParseErrorItem[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index].trim();
    if (!raw) {
      continue;
    }

    let payload: AccountPayload;
    try {
      payload = parseCaptchaLine(raw, DEFAULT_INGEST_CONFIG.delimiter);
    } catch (error) {
      errors.push({
        line: index + 1,
        raw,
        reason: error instanceof Error ? error.message : '格式错误'
      });
      continue;
    }

    try {
      const result = await c.env.DB
        .prepare(
          `INSERT OR IGNORE INTO accounts (account, password, client_id, refresh_token, remark)
           VALUES (?, ?, ?, ?, ?)`
        )
        .bind(
          payload.account,
          payload.password,
          toNullableText(payload.clientId),
          toNullableText(payload.refreshToken),
          toNullableText(payload.remark)
        )
        .run();

      if ((result.meta.changes ?? 0) > 0) {
        inserted += 1;
      } else {
        skipped += 1;
      }
    } catch (error) {
      errors.push({
        line: index + 1,
        raw,
        reason: error instanceof Error ? error.message : '数据库写入失败'
      });
    }
  }

  return c.json({ inserted, skipped, errors });
});

app.post('/api/accounts/refresh', async (c) => {
  const body = await readJson<{ accountIds?: unknown }>(c);
  const accountIds = parseAccountIds(body.accountIds);
  const accounts =
    accountIds.length > 0
      ? await fetchAccountsByIds(c.env.DB, accountIds)
      : await fetchAllAccounts(c.env.DB);

  if (accounts.length === 0) {
    throw new HTTPException(400, { message: '没有可刷新的账号' });
  }

  const details = await mapWithConcurrency(accounts, DEFAULT_REFRESH_CONCURRENCY, (account) =>
    refreshAccountToken(c.env.DB, account)
  );
  const success = details.filter((item) => item.ok).length;
  return c.json({
    total: details.length,
    success,
    failure: details.length - success,
    details
  });
});

app.get('/api/accounts/:id/messages', async (c) => {
  const id = parseNumericId(c.req.param('id'));
  const mode = parseMailFetchMode(c.req.query('mode'), 'graph');
  const account = await fetchAccountById(c.env.DB, id);

  if (!account) {
    throw new HTTPException(404, { message: '账号不存在' });
  }

  const result = await fetchAccountMessages(c.env.DB, account, mode, true);
  if (!result.ok) {
    throw new HTTPException(400, { message: result.message });
  }

  return c.json({
    accountId: account.id,
    account: account.account,
    mode,
    messages: result.messages
  });
});

app.get('/api/open/accounts/:id/messages', async (c) => {
  validateOpenApiToken(c, getMailApiToken(c.env));

  const id = parseNumericId(c.req.param('id'));
  const mode = parseMailFetchMode(c.req.query('mode'), 'graph');
  const account = await fetchAccountById(c.env.DB, id);

  if (!account) {
    throw new HTTPException(404, { message: '账号不存在' });
  }

  const result = await fetchAccountMessages(c.env.DB, account, mode, true);
  if (!result.ok) {
    throw new HTTPException(400, { message: result.message });
  }

  return c.json({
    accountId: account.id,
    account: account.account,
    mode,
    messages: result.messages
  });
});

app.post('/api/open/messages', async (c) => {
  validateOpenApiToken(c, getMailApiToken(c.env));

  const body = await readJson<{ id?: unknown; account?: unknown; mode?: unknown }>(c);
  const mode = parseMailFetchMode(body.mode, 'graph');

  const rawId = Number.parseInt(asText(body.id), 10);
  const accountById = Number.isInteger(rawId) && rawId > 0 ? await fetchAccountById(c.env.DB, rawId) : null;

  const accountText = asText(body.account).trim();
  const accountByName = accountText ? await fetchAccountByAccount(c.env.DB, accountText) : null;

  const account = accountById ?? accountByName;
  if (!account) {
    throw new HTTPException(400, { message: '请传入有效的 id 或 account' });
  }

  const result = await fetchAccountMessages(c.env.DB, account, mode, true);
  if (!result.ok) {
    throw new HTTPException(400, { message: result.message });
  }

  return c.json({
    accountId: account.id,
    account: account.account,
    mode,
    messages: result.messages
  });
});

app.patch('/api/open/accounts/:id/remark', async (c) => {
  validateOpenApiToken(c, getMailApiToken(c.env));

  const id = parseNumericId(c.req.param('id'));
  const body = await readJson<{ remark?: unknown }>(c);
  const remark = normalizeRemark(body.remark);

  const item = await updateAccountRemark(c.env.DB, id, remark);
  if (!item) {
    throw new HTTPException(404, { message: '账号不存在' });
  }

  return c.json({
    ok: true,
    id: item.id,
    account: item.account,
    remark: item.remark
  });
});

app.get('/api/ingest-config', async (c) => {
  const item = await getIngestConfig(c.env.DB);
  return c.json({
    item,
    endpointPath: INGEST_PATH,
    tokenHeader: INGEST_TOKEN_HEADER
  });
});

app.put('/api/ingest-config', async (c) => {
  const body = await readJson<Partial<IngestConfig>>(c);
  const item = normalizeIngestConfig(body);
  validateIngestConfig(item);

  await c.env.DB
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ('ingest_config', ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key)
       DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
    )
    .bind(JSON.stringify(item))
    .run();

  return c.json({ item });
});

app.post('/api/upload/ingest', async (c) => {
  const expectedToken = getIngestToken(c.env);
  const receivedToken = readIngestToken(c);
  if (!receivedToken || !timingSafeEqual(receivedToken, expectedToken)) {
    throw new HTTPException(401, { message: '上传令牌无效' });
  }

  const config = await getIngestConfig(c.env.DB);
  const incomingData = await readIncomingBody(c);
  const parsed = parseIncomingPayload(incomingData, config);

  let inserted = 0;
  let skipped = 0;
  const errors = [...parsed.errors];

  if (parsed.records.length > 5000) {
    throw new HTTPException(400, { message: '单次上传记录不能超过 5000 条' });
  }

  for (const record of parsed.records) {
    try {
      const payload = normalizeAccountPayload(record.payload, true);
      const result = await c.env.DB
        .prepare(
          `INSERT OR IGNORE INTO accounts (account, password, client_id, refresh_token, remark)
           VALUES (?, ?, ?, ?, ?)`
        )
        .bind(
          payload.account,
          payload.password,
          toNullableText(payload.clientId),
          toNullableText(payload.refreshToken),
          toNullableText(payload.remark)
        )
        .run();

      if ((result.meta.changes ?? 0) > 0) {
        inserted += 1;
      } else {
        skipped += 1;
      }
    } catch (error) {
      errors.push({
        line: record.line,
        raw: record.raw,
        reason: error instanceof Error ? error.message : '数据库写入失败'
      });
    }
  }

  const status = inserted === 0 && skipped === 0 && errors.length > 0 ? 400 : 200;
  return c.json({ inserted, skipped, errors }, status);
});

app.all('*', async (c) => {
  const pathname = new URL(c.req.url).pathname;
  if (pathname.startsWith('/api/')) {
    return c.json({ message: '接口不存在' }, 404);
  }

  const assetResponse = await c.env.ASSETS.fetch(c.req.raw);
  if (assetResponse.status !== 404 || c.req.method !== 'GET') {
    return assetResponse;
  }

  const indexUrl = new URL(c.req.url);
  indexUrl.pathname = '/index.html';
  const indexRequest = new Request(indexUrl.toString(), {
    method: 'GET',
    headers: c.req.raw.headers
  });
  return c.env.ASSETS.fetch(indexRequest);
});

app.onError((error, c) => {
  if (error instanceof HTTPException) {
    return c.json({ message: error.message }, error.status);
  }

  console.error(error);
  return c.json({ message: '服务器内部错误' }, 500);
});

export default app;

async function readJson<T>(c: Context<{ Bindings: Bindings; Variables: Variables }>): Promise<T> {
  try {
    return (await c.req.json()) as T;
  } catch {
    throw new HTTPException(400, { message: '请求体必须是合法 JSON' });
  }
}

async function readIncomingBody(c: Context<{ Bindings: Bindings; Variables: Variables }>): Promise<unknown> {
  const contentType = asText(c.req.header('content-type')).toLowerCase();
  if (contentType.includes('application/json')) {
    return readJson<unknown>(c);
  }

  const text = (await c.req.text()).trim();
  if (!text) {
    throw new HTTPException(400, { message: '上传内容不能为空' });
  }

  return text;
}

function asText(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value);
}

function toNullableText(value: unknown): string | null {
  const text = asText(value).trim();
  return text ? text : null;
}

function isUniqueConstraintError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return /unique/i.test(error.message);
}

function parseNumericId(value: string): number {
  const id = Number.parseInt(value, 10);
  if (!Number.isInteger(id) || id <= 0) {
    throw new HTTPException(400, { message: 'ID 非法' });
  }
  return id;
}

function normalizeAccountPayload(input: Partial<AccountPayload>, requireBase: boolean): AccountPayload {
  const account = asText(input.account).trim();
  const password = asText(input.password).trim();

  if (requireBase && (!account || !password)) {
    throw new HTTPException(400, { message: '账号和密码不能为空' });
  }

  const payload: AccountPayload = {
    account,
    password,
    clientId: asText(input.clientId).trim(),
    refreshToken: asText(input.refreshToken).trim(),
    remark: asText(input.remark).trim()
  };

  if (payload.account.length > 255 || payload.password.length > 255) {
    throw new HTTPException(400, { message: '账号或密码长度超过限制' });
  }

  return payload;
}

function normalizeRemark(input: unknown): string | null {
  const remark = asText(input).trim();
  if (remark.length > 500) {
    throw new HTTPException(400, { message: '备注长度不能超过 500' });
  }
  return remark || null;
}

function parseCaptchaLine(line: string, delimiter: string): AccountPayload {
  const parts = line.split(delimiter).map((item) => item.trim());
  if (parts.length < 2 || parts.length > 4) {
    throw new Error(
      `格式应为 账号${delimiter}密码 或 账号${delimiter}密码${delimiter}client_id${delimiter}refresh_token`
    );
  }

  const [account, password, clientId = '', refreshToken = ''] = parts;
  if (!account || !password) {
    throw new Error('账号和密码不能为空');
  }

  return {
    account,
    password,
    clientId,
    refreshToken,
    remark: ''
  };
}

async function getIngestConfig(db: D1Database): Promise<IngestConfig> {
  const row = await db
    .prepare('SELECT value FROM app_settings WHERE key = ? LIMIT 1')
    .bind('ingest_config')
    .first<{ value: string }>();

  if (!row?.value) {
    return DEFAULT_INGEST_CONFIG;
  }

  try {
    const parsed = JSON.parse(row.value) as Partial<IngestConfig>;
    return normalizeIngestConfig(parsed);
  } catch {
    return DEFAULT_INGEST_CONFIG;
  }
}

function normalizeIngestConfig(input: Partial<IngestConfig>): IngestConfig {
  return {
    delimiter: asText(input.delimiter).trim() || DEFAULT_INGEST_CONFIG.delimiter,
    captchaField: normalizeFieldName(input.captchaField, DEFAULT_INGEST_CONFIG.captchaField),
    accountField: normalizeFieldName(input.accountField, DEFAULT_INGEST_CONFIG.accountField),
    passwordField: normalizeFieldName(input.passwordField, DEFAULT_INGEST_CONFIG.passwordField),
    clientIdField: normalizeFieldName(input.clientIdField, DEFAULT_INGEST_CONFIG.clientIdField),
    tokenField: normalizeFieldName(input.tokenField, DEFAULT_INGEST_CONFIG.tokenField)
  };
}

function normalizeFieldName(value: unknown, fallback: string): string {
  const text = asText(value).trim();
  if (!text) {
    return fallback;
  }
  return text;
}

function validateIngestConfig(config: IngestConfig): void {
  if (config.delimiter.length < 1 || config.delimiter.length > 12) {
    throw new HTTPException(400, { message: '分隔符长度必须在 1 到 12 之间' });
  }

  const fields = [
    config.captchaField,
    config.accountField,
    config.passwordField,
    config.clientIdField,
    config.tokenField
  ];

  for (const field of fields) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(field)) {
      throw new HTTPException(400, { message: `字段名不合法: ${field}` });
    }
  }
}

function parseAccountIds(input: unknown): number[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const ids = input
    .map((value) => Number.parseInt(String(value), 10))
    .filter((value) => Number.isInteger(value) && value > 0);
  return Array.from(new Set(ids));
}

function parseMailFetchMode(value: unknown, fallback: MailFetchMode): MailFetchMode {
  const mode = asText(value).trim().toLowerCase();
  if (mode === 'imap' || mode === 'graph') {
    return mode;
  }
  return fallback;
}

function getScopeByMode(mode: MailFetchMode): string {
  if (mode === 'imap') {
    return IMAP_SCOPE;
  }
  return GRAPH_SCOPE;
}

async function queryAccounts(db: D1Database, keyword: string): Promise<AccountRow[]> {
  let statement: D1PreparedStatement;

  if (keyword) {
    const like = `%${keyword}%`;
    statement = db
      .prepare(
        `${ACCOUNT_SELECT_SQL}
         WHERE account LIKE ? OR IFNULL(remark, '') LIKE ?
         ORDER BY id DESC`
      )
      .bind(like, like);
  } else {
    statement = db.prepare(`${ACCOUNT_SELECT_SQL} ORDER BY id DESC`);
  }

  const { results } = await statement.all<AccountRow>();
  return results ?? [];
}

async function fetchAllAccounts(db: D1Database): Promise<AccountRow[]> {
  const { results } = await db.prepare(`${ACCOUNT_SELECT_SQL} ORDER BY id DESC`).all<AccountRow>();
  return results ?? [];
}

async function fetchAccountById(db: D1Database, id: number): Promise<AccountRow | null> {
  const row = await db.prepare(`${ACCOUNT_SELECT_SQL} WHERE id = ?`).bind(id).first<AccountRow>();
  return row ?? null;
}

async function updateAccountRemark(db: D1Database, id: number, remark: string | null): Promise<AccountRow | null> {
  const result = await db.prepare('UPDATE accounts SET remark = ? WHERE id = ?').bind(remark, id).run();
  if ((result.meta.changes ?? 0) === 0) {
    return null;
  }
  return fetchAccountById(db, id);
}

async function fetchAccountByAccount(db: D1Database, account: string): Promise<AccountRow | null> {
  const row = await db
    .prepare(`${ACCOUNT_SELECT_SQL} WHERE account = ? ORDER BY id DESC LIMIT 1`)
    .bind(account)
    .first<AccountRow>();
  return row ?? null;
}

async function fetchAccountsByIds(db: D1Database, ids: number[]): Promise<AccountRow[]> {
  if (ids.length === 0) {
    return [];
  }

  const placeholders = ids.map(() => '?').join(',');
  const statement = db
    .prepare(`${ACCOUNT_SELECT_SQL} WHERE id IN (${placeholders}) ORDER BY id DESC`)
    .bind(...ids);
  const { results } = await statement.all<AccountRow>();
  return results ?? [];
}

async function refreshAccountToken(db: D1Database, account: AccountRow): Promise<BatchActionDetail> {
  if (!account.clientId || !account.refreshToken) {
    const message = '缺少 client_id 或 refresh_token';
    await updateSyncStatus(db, account.id, {
      status: 'refresh_failed',
      message,
      touchRefresh: true,
      touchFetch: false,
      fetchedCount: account.fetchedCount
    });
    return {
      id: account.id,
      account: account.account,
      ok: false,
      message
    };
  }

  const exchanged = await exchangeMicrosoftToken(account.refreshToken, account.clientId);
  if (!exchanged.ok) {
    const message = exchanged.error || '刷新失败';
    await updateSyncStatus(db, account.id, {
      status: 'refresh_failed',
      message,
      touchRefresh: true,
      touchFetch: false,
      fetchedCount: account.fetchedCount
    });
    return {
      id: account.id,
      account: account.account,
      ok: false,
      message
    };
  }

  const tokenResult = exchanged.result;

  const newRefreshToken = tokenResult.refreshToken || account.refreshToken;
  await db
    .prepare('UPDATE accounts SET refresh_token = ? WHERE id = ?')
    .bind(newRefreshToken, account.id)
    .run();

  const message = '刷新成功';
  await updateSyncStatus(db, account.id, {
    status: 'refresh_success',
    message,
    touchRefresh: true,
    touchFetch: false,
    fetchedCount: account.fetchedCount
  });

  return {
    id: account.id,
    account: account.account,
    ok: true,
    message
  };
}

async function fetchAccountMessages(
  db: D1Database,
  account: AccountRow,
  mode: MailFetchMode,
  includeBody = true
): Promise<FetchActionResult> {
  if (!account.clientId || !account.refreshToken) {
    const message = '缺少 client_id 或 refresh_token';
    await updateSyncStatus(db, account.id, {
      status: 'fetch_failed',
      message,
      touchRefresh: false,
      touchFetch: true,
      fetchedCount: 0
    });
    return {
      ok: false,
      message,
      fetchedCount: 0,
      messages: []
    };
  }

  const exchanged = await exchangeMicrosoftToken(
    account.refreshToken,
    account.clientId,
    getScopeByMode(mode)
  );
  if (!exchanged.ok) {
    const message = exchanged.error || `${mode.toUpperCase()}取件前刷新令牌失败`;
    await updateSyncStatus(db, account.id, {
      status: 'fetch_failed',
      message,
      touchRefresh: true,
      touchFetch: true,
      fetchedCount: 0
    });
    return {
      ok: false,
      message,
      fetchedCount: 0,
      messages: []
    };
  }

  const tokenResult = exchanged.result;
  const newRefreshToken = tokenResult.refreshToken || account.refreshToken;
  await db
    .prepare('UPDATE accounts SET refresh_token = ? WHERE id = ?')
    .bind(newRefreshToken, account.id)
    .run();

  const fetched =
    mode === 'imap'
      ? await readImapMessagesViaOutlookApi(tokenResult.accessToken, includeBody)
      : await readGraphMessages(tokenResult.accessToken, includeBody);
  if (!fetched.ok) {
    const message = fetched.error || `${mode.toUpperCase()}取件失败`;
    await updateSyncStatus(db, account.id, {
      status: 'fetch_failed',
      message,
      touchRefresh: true,
      touchFetch: true,
      fetchedCount: 0
    });
    return {
      ok: false,
      message,
      fetchedCount: 0,
      messages: []
    };
  }

  const fetchedCount = fetched.messages.length;
  const message = `取件成功(${mode.toUpperCase()})，共 ${fetchedCount} 封`;
  await updateSyncStatus(db, account.id, {
    status: 'fetch_success',
    message,
    touchRefresh: true,
    touchFetch: true,
    fetchedCount
  });

  return {
    ok: true,
    message,
    fetchedCount,
    messages: fetched.messages
  };
}

async function exchangeMicrosoftToken(
  refreshToken: string,
  clientId: string,
  scope = ''
): Promise<{ ok: true; result: TokenExchangeResult } | { ok: false; error: string }> {
  const params = new URLSearchParams();
  params.set('client_id', clientId);
  params.set('grant_type', 'refresh_token');
  params.set('refresh_token', refreshToken);
  if (scope) {
    params.set('scope', scope);
  }

  let response: Response;
  try {
    response = await fetch(MICROSOFT_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });
  } catch (error) {
    return {
      ok: false,
      error: `刷新请求异常: ${error instanceof Error ? error.message : 'unknown error'}`
    };
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      ok: false,
      error: extractMicrosoftError(payload, response.status)
    };
  }

  const accessToken = asText((payload as Record<string, unknown>).access_token).trim();
  if (!accessToken) {
    return {
      ok: false,
      error: '刷新响应缺少 access_token'
    };
  }

  return {
    ok: true,
    result: {
      accessToken,
      refreshToken: asText((payload as Record<string, unknown>).refresh_token).trim()
    }
  };
}

async function readGraphMessages(
  accessToken: string,
  includeBody = false
): Promise<{ ok: true; messages: AccountMailItem[] } | { ok: false; error: string }> {
  const select = includeBody
    ? 'id,subject,from,receivedDateTime,bodyPreview,body'
    : 'id,subject,from,receivedDateTime,bodyPreview';

  const firstUrl = new URL(GRAPH_MESSAGES_URL);
  firstUrl.searchParams.set('$top', String(MAIL_PAGE_SIZE));
  firstUrl.searchParams.set('$orderby', 'receivedDateTime desc');
  firstUrl.searchParams.set('$select', select);

  const allMessages: AccountMailItem[] = [];
  let nextUrl: string | null = firstUrl.toString();

  while (nextUrl) {
    let response: Response;
    try {
      response = await fetch(nextUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      });
    } catch (error) {
      return {
        ok: false,
        error: `Graph请求异常: ${error instanceof Error ? error.message : 'unknown error'}`
      };
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        ok: false,
        error: extractMicrosoftError(payload, response.status)
      };
    }

    const value = (payload as Record<string, unknown>).value;
    if (!Array.isArray(value)) {
      return {
        ok: false,
        error: 'Graph响应格式错误，缺少value数组'
      };
    }

    allMessages.push(
      ...value
        .filter((item) => !!item && typeof item === 'object')
        .map((item) => normalizeGraphMailItem(item as Record<string, unknown>, includeBody))
    );

    const nextLink = asText((payload as Record<string, unknown>)['@odata.nextLink']).trim();
    nextUrl = nextLink || null;
  }

  return {
    ok: true,
    messages: allMessages
  };
}

async function readImapMessagesViaOutlookApi(
  accessToken: string,
  includeBody = false
): Promise<{ ok: true; messages: AccountMailItem[] } | { ok: false; error: string }> {
  const select = includeBody
    ? 'Id,Subject,From,DateTimeReceived,BodyPreview,Body'
    : 'Id,Subject,From,DateTimeReceived,BodyPreview';

  const firstUrl = new URL(OUTLOOK_MESSAGES_URL);
  firstUrl.searchParams.set('$top', String(MAIL_PAGE_SIZE));
  firstUrl.searchParams.set('$orderby', 'DateTimeReceived desc');
  firstUrl.searchParams.set('$select', select);

  const allMessages: AccountMailItem[] = [];
  let nextUrl: string | null = firstUrl.toString();

  while (nextUrl) {
    let response: Response;
    try {
      response = await fetch(nextUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      });
    } catch (error) {
      return {
        ok: false,
        error: `IMAP请求异常: ${error instanceof Error ? error.message : 'unknown error'}`
      };
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        ok: false,
        error: extractMicrosoftError(payload, response.status)
      };
    }

    const value = (payload as Record<string, unknown>).value;
    if (!Array.isArray(value)) {
      return {
        ok: false,
        error: 'IMAP响应格式错误，缺少value数组'
      };
    }

    allMessages.push(
      ...value
        .filter((item) => !!item && typeof item === 'object')
        .map((item) => normalizeOutlookMailItem(item as Record<string, unknown>, includeBody))
    );

    const nextLink = asText((payload as Record<string, unknown>)['@odata.nextLink']).trim();
    const fallbackNextLink = asText((payload as Record<string, unknown>)['odata.nextLink']).trim();
    nextUrl = nextLink || fallbackNextLink || null;
  }

  return {
    ok: true,
    messages: allMessages
  };
}

function normalizeGraphMailItem(item: Record<string, unknown>, includeBody: boolean): AccountMailItem {
  const fromNode = item.from;
  let from = '';
  if (fromNode && typeof fromNode === 'object') {
    const mailAddressNode = (fromNode as Record<string, unknown>).emailAddress;
    if (mailAddressNode && typeof mailAddressNode === 'object') {
      from = asText((mailAddressNode as Record<string, unknown>).address).trim();
    }
  }

  let contentType = '';
  let content = '';
  if (includeBody) {
    const bodyNode = item.body;
    if (bodyNode && typeof bodyNode === 'object') {
      const bodyRecord = bodyNode as Record<string, unknown>;
      contentType = asText(bodyRecord.contentType).trim().toLowerCase();
      content = asText(bodyRecord.content).trim();
    }
  }

  return {
    id: asText(item.id).trim(),
    subject: asText(item.subject).trim(),
    from,
    receivedAt: asText(item.receivedDateTime).trim(),
    preview: asText(item.bodyPreview).trim(),
    contentType,
    content
  };
}

function normalizeOutlookMailItem(item: Record<string, unknown>, includeBody: boolean): AccountMailItem {
  const fromNode = item.From;
  let from = '';
  if (fromNode && typeof fromNode === 'object') {
    const emailNode = (fromNode as Record<string, unknown>).EmailAddress;
    if (emailNode && typeof emailNode === 'object') {
      from = asText((emailNode as Record<string, unknown>).Address).trim();
    }
  }

  let contentType = '';
  let content = '';
  if (includeBody) {
    const bodyNode = item.Body;
    if (bodyNode && typeof bodyNode === 'object') {
      const bodyRecord = bodyNode as Record<string, unknown>;
      contentType = asText(bodyRecord.ContentType).trim().toLowerCase();
      content = asText(bodyRecord.Content).trim();
    }
  }

  return {
    id: asText(item.Id).trim(),
    subject: asText(item.Subject).trim(),
    from,
    receivedAt: asText(item.DateTimeReceived).trim(),
    preview: asText(item.BodyPreview).trim(),
    contentType,
    content
  };
}

function extractMicrosoftError(payload: unknown, status: number): string {
  if (payload && typeof payload === 'object') {
    const asRecord = payload as Record<string, unknown>;
    const direct = asText(asRecord.error_description || asRecord.error).trim();
    if (direct) {
      return `请求失败(${status}): ${direct}`;
    }

    const nested = asRecord.error;
    if (nested && typeof nested === 'object') {
      const nestedRecord = nested as Record<string, unknown>;
      const message = asText(nestedRecord.message).trim();
      if (message) {
        return `请求失败(${status}): ${message}`;
      }
    }
  }

  return `请求失败(${status})`;
}

async function updateSyncStatus(
  db: D1Database,
  accountId: number,
  params: {
    status: string;
    message: string;
    touchRefresh: boolean;
    touchFetch: boolean;
    fetchedCount: number;
  }
): Promise<void> {
  await db
    .prepare(
      `UPDATE accounts
       SET
         sync_status = ?,
         sync_message = ?,
         refreshed_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE refreshed_at END,
         fetched_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE fetched_at END,
         fetched_count = ?
       WHERE id = ?`
    )
    .bind(
      params.status,
      truncate(params.message, 600),
      params.touchRefresh ? 1 : 0,
      params.touchFetch ? 1 : 0,
      params.fetchedCount,
      accountId
    )
    .run();
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }

  const size = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array<R>(items.length);
  let cursor = 0;

  const workers = Array.from({ length: size }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) {
        break;
      }

      results[index] = await mapper(items[index], index);
    }
  });

  await Promise.all(workers);
  return results;
}

function parseIncomingPayload(input: unknown, config: IngestConfig): ParseIncomingResult {
  const records: ParsedAccount[] = [];
  const errors: ParseErrorItem[] = [];

  const pushError = (line: number, raw: unknown, reason: string): void => {
    errors.push({
      line,
      raw: truncate(asText(raw), 240),
      reason
    });
  };

  const handleCaptchaText = (text: string, lineStart: number): void => {
    const lines = text.split(/\r?\n/);
    let offset = 0;
    for (const sourceLine of lines) {
      const raw = sourceLine.trim();
      if (!raw) {
        offset += 1;
        continue;
      }

      try {
        const payload = parseCaptchaLine(raw, config.delimiter);
        records.push({ line: lineStart + offset, raw, payload });
      } catch (error) {
        pushError(lineStart + offset, raw, error instanceof Error ? error.message : '格式错误');
      }

      offset += 1;
    }
  };

  const handleObject = (obj: Record<string, unknown>, line: number): void => {
    const captchaNode = obj[config.captchaField];
    if (typeof captchaNode === 'string') {
      handleCaptchaText(captchaNode, line);
      return;
    }

    if (Array.isArray(captchaNode)) {
      captchaNode.forEach((item, index) => {
        consume(item, line + index);
      });
      return;
    }

    const mappedHasAccount = hasOwnKey(obj, config.accountField);
    const mappedHasPassword = hasOwnKey(obj, config.passwordField);
    if (mappedHasAccount || mappedHasPassword) {
      const account = asText(obj[config.accountField]).trim();
      const password = asText(obj[config.passwordField]).trim();
      if (!account || !password) {
        pushError(line, safeStringify(obj), `字段 ${config.accountField} 和 ${config.passwordField} 不能为空`);
        return;
      }

      records.push({
        line,
        raw: safeStringify(obj),
        payload: {
          account,
          password,
          clientId: asText(obj[config.clientIdField]).trim(),
          refreshToken: asText(obj[config.tokenField]).trim(),
          remark: ''
        }
      });
      return;
    }

    const plainHasAccount = hasOwnKey(obj, 'account');
    const plainHasPassword = hasOwnKey(obj, 'password');
    if (plainHasAccount || plainHasPassword) {
      const account = asText(obj.account).trim();
      const password = asText(obj.password).trim();
      if (!account || !password) {
        pushError(line, safeStringify(obj), '字段 account 和 password 不能为空');
        return;
      }

      records.push({
        line,
        raw: safeStringify(obj),
        payload: {
          account,
          password,
          clientId: asText(obj.clientId ?? obj.client_id).trim(),
          refreshToken: asText(obj.refreshToken ?? obj.refresh_token).trim(),
          remark: asText(obj.remark).trim()
        }
      });
      return;
    }

    const nestedList = obj.items ?? obj.list ?? null;
    if (Array.isArray(nestedList)) {
      nestedList.forEach((item, index) => {
        consume(item, line + index);
      });
      return;
    }

    pushError(line, safeStringify(obj), '无法识别的上传数据格式');
  };

  const consume = (node: unknown, line: number): void => {
    if (typeof node === 'string') {
      handleCaptchaText(node, line);
      return;
    }

    if (Array.isArray(node)) {
      node.forEach((item, index) => {
        consume(item, line + index);
      });
      return;
    }

    if (!node || typeof node !== 'object') {
      pushError(line, safeStringify(node), '上传内容必须是字符串、对象或数组');
      return;
    }

    handleObject(node as Record<string, unknown>, line);
  };

  consume(input, 1);
  return { records, errors };
}

function hasOwnKey(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function safeStringify(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return asText(value);
  }
}

function truncate(input: string, limit: number): string {
  if (input.length <= limit) {
    return input;
  }
  return `${input.slice(0, limit)}...`;
}

function isPublicApiPath(pathname: string): boolean {
  return (
    pathname === '/api/health' ||
    pathname === '/api/auth/login' ||
    pathname === INGEST_PATH ||
    pathname === OPEN_MESSAGES_PATH ||
    pathname === '/api/open/accounts' ||
    /^\/api\/open\/accounts\/\d+\/messages$/.test(pathname) ||
    /^\/api\/open\/accounts\/\d+\/remark$/.test(pathname)
  );
}

async function authenticateRequest(c: Context<{ Bindings: Bindings; Variables: Variables }>): Promise<string | null> {
  const token = getCookie(c, SESSION_COOKIE_NAME);
  if (!token) {
    return null;
  }

  const secret = getSessionSecret(c.env);
  const session = await verifySessionToken(token, secret);
  if (!session) {
    return null;
  }

  return session.username;
}

function getConfiguredUsername(env: Bindings): string {
  return asText(env.ADMIN_USERNAME).trim() || 'admin';
}

function getConfiguredPassword(env: Bindings): string {
  const password = asText(env.ADMIN_PASSWORD);
  if (!password) {
    throw new HTTPException(500, {
      message: '服务端未配置 ADMIN_PASSWORD，请执行 wrangler secret put ADMIN_PASSWORD'
    });
  }
  return password;
}

function getSessionSecret(env: Bindings): string {
  const secret = asText(env.SESSION_SECRET);
  if (!secret) {
    throw new HTTPException(500, {
      message: '服务端未配置 SESSION_SECRET，请执行 wrangler secret put SESSION_SECRET'
    });
  }
  return secret;
}

function getIngestToken(env: Bindings): string {
  const token = asText(env.INGEST_TOKEN);
  if (!token) {
    throw new HTTPException(500, {
      message: '服务端未配置 INGEST_TOKEN，请执行 wrangler secret put INGEST_TOKEN'
    });
  }
  return token;
}

function getMailApiToken(env: Bindings): string {
  const token = asText(env.MAIL_API_TOKEN || env.INGEST_TOKEN).trim();
  if (!token) {
    throw new HTTPException(500, {
      message:
        '服务端未配置 MAIL_API_TOKEN（或可复用 INGEST_TOKEN），请执行 wrangler secret put MAIL_API_TOKEN'
    });
  }
  return token;
}

function readIngestToken(c: Context<{ Bindings: Bindings; Variables: Variables }>): string {
  const headerToken = asText(c.req.header(INGEST_TOKEN_HEADER)).trim();
  if (headerToken) {
    return headerToken;
  }

  const authHeader = asText(c.req.header('authorization')).trim();
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }

  return asText(c.req.query('token')).trim();
}

function readOpenApiToken(c: Context<{ Bindings: Bindings; Variables: Variables }>): string {
  const mailHeaderToken = asText(c.req.header(MAIL_API_TOKEN_HEADER)).trim();
  if (mailHeaderToken) {
    return mailHeaderToken;
  }

  const apiToken = asText(c.req.header('x-api-token')).trim();
  if (apiToken) {
    return apiToken;
  }

  const ingestHeaderToken = asText(c.req.header(INGEST_TOKEN_HEADER)).trim();
  if (ingestHeaderToken) {
    return ingestHeaderToken;
  }

  const authHeader = asText(c.req.header('authorization')).trim();
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }

  return asText(c.req.query('token')).trim();
}

function validateOpenApiToken(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  expectedToken: string
): void {
  const receivedToken = readOpenApiToken(c);
  if (!receivedToken || !timingSafeEqual(receivedToken, expectedToken)) {
    throw new HTTPException(401, { message: '开放接口令牌无效' });
  }
}

async function createSessionToken(username: string, secret: string): Promise<string> {
  const payload: SessionPayload = {
    username,
    exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS
  };

  const encodedPayload = encodeBase64UrlText(JSON.stringify(payload));
  const signature = await signValue(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

async function verifySessionToken(token: string, secret: string): Promise<SessionPayload | null> {
  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = await signValue(encodedPayload, secret);
  if (!timingSafeEqual(signature, expectedSignature)) {
    return null;
  }

  let payload: Partial<SessionPayload>;
  try {
    payload = JSON.parse(decodeBase64UrlText(encodedPayload)) as Partial<SessionPayload>;
  } catch {
    return null;
  }

  if (typeof payload.username !== 'string' || typeof payload.exp !== 'number') {
    return null;
  }

  if (payload.exp <= Math.floor(Date.now() / 1000)) {
    return null;
  }

  return {
    username: payload.username,
    exp: payload.exp
  };
}

async function signValue(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, textEncoder.encode(value));
  return encodeBase64UrlBytes(new Uint8Array(signature));
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return result === 0;
}

function encodeBase64UrlText(input: string): string {
  return encodeBase64UrlBytes(textEncoder.encode(input));
}

function decodeBase64UrlText(input: string): string {
  return textDecoder.decode(decodeBase64UrlBytes(input));
}

function encodeBase64UrlBytes(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64UrlBytes(input: string): Uint8Array {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const paddingLength = base64.length % 4;
  const padded = paddingLength === 0 ? base64 : `${base64}${'='.repeat(4 - paddingLength)}`;
  const binary = atob(padded);

  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function isHttpsRequest(url: string): boolean {
  return new URL(url).protocol === 'https:';
}
