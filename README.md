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
MAIL_API_TOKEN=replace_with_mail_api_token
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

### 2) Cloudflare 构建配置（Git 集成部署）

在 Cloudflare 的 **构建** 页面建议使用：

- 构建命令：`npm run build`
- 部署命令：`npm run deploy:cf`
- 版本命令：`npx wrangler versions upload`（可选）

并在 **设置 > 构建 > 变量和机密** 中添加这些变量：
(注意不是 **设置 > 变量和机密**, 而是 **设置 > 构建 > 变量和机密**)
- `D1_DATABASE_ID`：D1 数据库真实 ID（必须）
- `ADMIN_PASSWORD`：后台登录密码（必须）
- `SESSION_SECRET`：会话签名密钥（必须）
- `INGEST_TOKEN`：外部上传接口令牌（必须）
- `MAIL_API_TOKEN`：开放取件接口令牌（推荐，未设置时会回退使用 `INGEST_TOKEN`）
- `ADMIN_USERNAME`：后台用户名（可选，默认 `admin`）

部署时 `prepare:cf-config` 会自动生成临时 `.wrangler.deploy.toml`，并注入以上变量到部署配置。

### 3) 本地 CLI 部署（可选）

如果你不用 Cloudflare Git 构建，而是本地命令部署：

PowerShell 示例：

```powershell
$env:D1_DATABASE_ID = "your-d1-database-id"
$env:ADMIN_PASSWORD = "your-admin-password"
$env:SESSION_SECRET = "your-session-secret"
$env:INGEST_TOKEN = "your-ingest-token"
$env:MAIL_API_TOKEN = "your-mail-api-token"
$env:ADMIN_USERNAME = "admin"
npm run deploy
```

### 4) 迁移 + 部署

```bash
npm run deploy
```

脚本说明：

- `npm run prepare:cf-config`：读取构建变量并生成 `.wrangler.deploy.toml`
- `npm run migrate:local`：执行本地 D1 迁移
- `npm run migrate:remote`：执行远程 D1 迁移
- `npm run deploy:cf`：迁移 + wrangler deploy
- `npm run deploy`：先构建前端，再执行 deploy:cf

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

- `POST /api/upload/ingest`：外部系统上传账号数据到本系统
- 鉴权方式：
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

## 开放取件 API（给其他平台调用）

以下接口**不需要后台登录 Cookie**，使用 token 鉴权即可：

- `GET /api/open/accounts/:id/messages?mode=graph|imap`
  - 作用：按账号 ID 获取该账号全部邮件（Graph 或 IMAP 模式）
  - 适用：你已知道账号 ID 的场景
- `POST /api/open/messages`
  - 作用：按 `id` 或 `account` 获取该账号全部邮件
  - 适用：第三方平台只知道邮箱地址时

鉴权方式（任选其一）：

- `x-mail-api-token: <MAIL_API_TOKEN>`
- `x-api-token: <MAIL_API_TOKEN>`
- `Authorization: Bearer <MAIL_API_TOKEN>`

> 若未设置 `MAIL_API_TOKEN`，系统会回退使用 `INGEST_TOKEN`。

`POST /api/open/messages` 请求体示例：

```json
{
  "account": "example@outlook.com",
  "mode": "graph"
}
```

调用示例：

```bash
# 通过账号ID取件
curl "https://your-domain/api/open/accounts/1/messages?mode=graph" \
  -H "x-mail-api-token: your_mail_api_token"

# 通过邮箱地址取件
curl -X POST "https://your-domain/api/open/messages" \
  -H "Content-Type: application/json" \
  -H "x-mail-api-token: your_mail_api_token" \
  -d '{"account":"example@outlook.com","mode":"imap"}'
```

---

## 管理端 API（需登录）

- `POST /api/auth/login`：后台管理员登录，返回会话 Cookie
- `POST /api/auth/logout`：退出当前登录会话
- `GET /api/auth/me`：获取当前登录用户信息
- `GET /api/accounts`：获取账号列表（支持关键词查询）
- `POST /api/accounts`：新增单个账号
- `PUT /api/accounts/:id`：更新指定账号
- `DELETE /api/accounts/:id`：删除指定账号
- `POST /api/accounts/import`：批量导入账号文本
- `POST /api/accounts/refresh`：批量刷新账号 refresh_token
- `GET /api/accounts/:id/messages?mode=graph|imap`：按账号 ID 拉取全部邮件（管理端用）
- `GET /api/ingest-config`：读取外部上传字段映射配置
- `PUT /api/ingest-config`：更新外部上传字段映射配置

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
