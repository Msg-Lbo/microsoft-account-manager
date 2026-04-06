# Microsoft Account Manager

一个部署在 **Cloudflare Workers** 的微软账号管理系统，支持账号存储、批量导入、令牌刷新、以及按账号查看邮件（Graph / IMAP 模式）。

前端：Vue 3 + Naive UI  
后端：Hono + D1

---

## 功能概览

- 账号增删改查：`account / password / client_id / refresh_token / remark`
- 批量导入：支持文本粘贴与 `.txt` 文件导入
- 状态列：展示每个账号最近刷新/取件状态
- 批量刷新：支持“刷新选中”与“刷新全部”
- 邮件查看：点击账号直接弹出邮件窗口（左侧邮件列表，右侧邮件内容）
- 取件模式：支持 `Graph` 与 `IMAP` 两种模式
- 外部上传接口：支持 token 鉴权上传账号
- 管理后台登录：基于 HttpOnly Cookie 会话

---

## 项目结构

```text
.
├─ src/                     # 前端
├─ worker/index.ts          # Worker API
├─ migrations/              # D1 迁移
├─ wrangler.toml            # Cloudflare 配置
└─ README.md
```

---

## 前置要求

- Node.js 18+
- npm
- Wrangler CLI（已在依赖内）
- Cloudflare 账号（用于线上部署）

---

## 本地开发

### 1) 安装依赖

```bash
npm install
```

### 2) 准备本地环境变量

在项目根目录创建 `.dev.vars`：

```env
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your_password
SESSION_SECRET=replace_with_long_random_secret
INGEST_TOKEN=replace_with_upload_token
```

### 3) 初始化本地 D1

首次本地运行建议执行：

```bash
npm run migrate:local
```

### 4) 启动服务

终端 1：

```bash
npm run dev:worker
```

终端 2：

```bash
npm run dev
```

Vite 已代理 `/api` 到 `http://127.0.0.1:8787`。

---

## 部署到 Cloudflare

### 1) 创建 D1

```bash
wrangler d1 create account_manager_db
```

创建后会返回一个 `database_id`，例如：`7c6500bb-xxxx-xxxx-xxxx-xxxxxxxxxxxx`。

本项目默认把 `wrangler.toml` 中的 `database_id` 留作占位符，避免开源仓库泄露真实配置：

```toml
[[d1_databases]]
binding = "DB"
database_name = "account_manager_db"
database_id = "REPLACE_WITH_YOUR_D1_DATABASE_ID"
```

### 2) 设置部署变量（推荐）

在 Cloudflare 项目里新增环境变量（非 Secret）：

- `D1_DATABASE_ID` = 你的真实 database_id

部署时脚本会自动生成临时配置 `.wrangler.deploy.toml`，并替换占位符。

### 3) 配置 Secrets

```bash
wrangler secret put ADMIN_PASSWORD
wrangler secret put SESSION_SECRET
wrangler secret put INGEST_TOKEN
```

### 4) 迁移 + 部署

```bash
npm run deploy
```

脚本说明：

- `npm run prepare:cf-config`：根据 `D1_DATABASE_ID` 生成 `.wrangler.deploy.toml`
- `npm run migrate:local`：执行本地 D1 迁移
- `npm run migrate:remote`：执行远程 D1 迁移
- `npm run deploy:cf`：迁移 + wrangler deploy
- `npm run deploy`：先构建前端，再执行 deploy:cf

如果用 Cloudflare 页面构建：

- 构建命令：`npm run build`
- 部署命令：`npm run deploy:cf`

如果你在本地 CLI 手动部署，也可以先设置环境变量再执行：

PowerShell:

```powershell
$env:D1_DATABASE_ID = "your-d1-database-id"
npm run deploy
```

---

## 账号导入格式

每行一条，默认分隔符 `----`：

```text
账号----密码
账号----密码----client_id----refresh_token
```

空行会自动忽略，重复记录会跳过。

---

## 邮件取件说明（管理后台）

- 在账号列表顶部可切换取件模式：`Graph / IMAP`
- 点击任意账号邮箱，会自动拉取该账号**全部邮件**并弹窗展示
- 弹窗左侧邮件列表，右侧邮件正文
- 每次取件会同步更新该账号状态列
- 受 Workers 运行环境限制，`IMAP` 模式使用 Outlook OAuth 接口做兼容读取，不是原生 TCP IMAP 直连

状态列含义：

- `未处理`
- `刷新成功`
- `刷新失败`
- `取件成功(n)`
- `取件失败`

---

## 外部上传接口

用于“外部系统上传账号到本系统”。

- 路径：`POST /api/upload/ingest`
- 鉴权：
  - `x-ingest-token: <INGEST_TOKEN>`
  - 或 `Authorization: Bearer <INGEST_TOKEN>`

### 示例 1（captchaurn）

```json
{
  "data": "account----password----client_id----refresh_token"
}
```

### 示例 2（字段映射）

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

---

## 管理端 API（核心）

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/accounts`
- `POST /api/accounts`
- `PUT /api/accounts/:id`
- `DELETE /api/accounts/:id`
- `POST /api/accounts/import`
- `POST /api/accounts/refresh`
- `GET /api/accounts/:id/messages?mode=graph|imap`
- `GET /api/ingest-config`
- `PUT /api/ingest-config`

`/api/accounts/refresh` 请求体示例：

```json
{
  "accountIds": [1, 2, 3]
}
```

> 不传 `accountIds` 时，默认刷新全部账号。

---

## 开源前建议

- 确保 `wrangler.toml` 中不包含真实 `database_id`
- 不要提交任何账号、token、cookie、`.env` / `.dev.vars`
- 首次部署后建议尽快更换 `INGEST_TOKEN`

---

## 常见问题

### 1) 接口 500

通常是：

- 缺少 secrets（`ADMIN_PASSWORD` / `SESSION_SECRET` / `INGEST_TOKEN`）
- D1 迁移未执行

### 2) 登录后访问失败

先确认 Worker 绑定的域名、`SESSION_SECRET` 是否正确配置，并重新部署。

### 3) 取件慢

当前是“点击账号拉取全部邮件”，邮件较多时响应会变慢，属于预期行为。
