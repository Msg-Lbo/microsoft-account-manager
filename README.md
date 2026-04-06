# Cloudflare 账号管理服务

这是一个可部署到 Cloudflare Workers 的账号管理 Web 服务，前端使用 Vue 3 + Naive UI，后端使用 Hono + D1。

## 功能

- 账号增删改查（账号、密码、client_id、refresh_token、备注）
- 后台登录鉴权（HttpOnly Cookie 会话）
- 支持外部系统上传账号到本服务：`POST /api/upload/ingest`
- 支持两种上传数据格式：
  - `captchaurn` 行格式（如 `账号----密码----client_id----refresh_token`）
  - 字段映射格式（如 `{ "a":"...", "p":"...", "c":"...", "t":"..." }`）
- 后台可配置分隔符和字段映射

## 本地开发

1. 安装依赖：

```bash
npm install
```

2. 新建 `.dev.vars`（供 `wrangler dev` 使用）：

```env
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your_password
SESSION_SECRET=replace_with_long_random_secret
INGEST_TOKEN=replace_with_upload_token
```

3. 启动 Worker API：

```bash
npm run dev:worker
```

4. 启动前端：

```bash
npm run dev
```

`vite.config.ts` 已将 `/api` 代理到 `http://127.0.0.1:8787`。

## 部署到 Cloudflare

1. 创建 D1 数据库：

```bash
wrangler d1 create account_manager_db
```

2. 把返回的 `database_id` 填入 `wrangler.toml` 的 `[[d1_databases]]`。

3. 设置 Secrets：

```bash
wrangler secret put ADMIN_PASSWORD
wrangler secret put SESSION_SECRET
wrangler secret put INGEST_TOKEN
```

4. 执行数据库迁移：

```bash
wrangler d1 migrations apply account_manager_db --remote
```

5. 构建并部署：

```bash
npm run deploy
```

## 外部上传接口

- 路径：`/api/upload/ingest`
- 方法：`POST`
- 鉴权：请求头 `x-ingest-token: <INGEST_TOKEN>`（也支持 `Authorization: Bearer <INGEST_TOKEN>`）

### 示例 1：captchaurn

```json
{
  "data": "account----password----client_id----refresh_token"
}
```

### 示例 2：字段映射

```json
{
  "a": "account",
  "p": "password",
  "c": "client_id",
  "t": "refresh_token"
}
```

返回示例：

```json
{
  "inserted": 10,
  "skipped": 2,
  "errors": []
}
```

## 目录结构

- `src/` 前端页面（Naive UI）
- `worker/index.ts` Worker API 与静态资源入口
- `migrations/` D1 迁移 SQL
- `wrangler.toml` Cloudflare 配置
