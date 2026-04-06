<template>
  <div v-if="authLoading" class="auth-shell">
    <n-spin size="large" />
  </div>

  <div v-else-if="!isAuthenticated" class="auth-shell">
    <n-card class="login-card" title="后台登录" size="small">
      <n-form label-placement="top">
        <n-form-item label="用户名">
          <n-input
            v-model:value="loginForm.username"
            placeholder="请输入用户名"
            @keyup.enter="handleLogin"
          />
        </n-form-item>
        <n-form-item label="密码">
          <n-input
            v-model:value="loginForm.password"
            type="password"
            show-password-on="click"
            placeholder="请输入密码"
            @keyup.enter="handleLogin"
          />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button type="primary" :loading="loginLoading" @click="handleLogin">登录</n-button>
        </n-space>
      </template>
    </n-card>
  </div>

  <div v-else class="page">
    <section class="hero">
      <div>
        <p class="hero-badge">Cloudflare Worker + D1</p>
        <h1>账号管理与上传中心</h1>
        <p>支持外部系统直接上传账号到本服务，并在后台统一管理。</p>
      </div>
      <n-space align="center" class="hero-actions">
        <n-tag type="success" size="small">已登录：{{ currentUser }}</n-tag>
        <n-button quaternary :loading="logoutLoading" @click="handleLogout">退出登录</n-button>
      </n-space>
    </section>

    <n-tabs v-model:value="activeTab" type="segment" animated>
      <n-tab-pane name="accounts" tab="账号管理">
        <n-space vertical size="large">
          <n-card title="新增账号" size="small">
            <n-grid :x-gap="12" :y-gap="12" :cols="24">
              <n-gi :span="6">
                <n-form-item label="账号">
                  <n-input v-model:value="createForm.account" placeholder="请输入账号" />
                </n-form-item>
              </n-gi>
              <n-gi :span="6">
                <n-form-item label="密码">
                  <n-input
                    v-model:value="createForm.password"
                    type="password"
                    show-password-on="click"
                    placeholder="请输入密码"
                  />
                </n-form-item>
              </n-gi>
              <n-gi :span="6">
                <n-form-item label="Client ID（可选）">
                  <n-input v-model:value="createForm.clientId" placeholder="client_id" />
                </n-form-item>
              </n-gi>
              <n-gi :span="6">
                <n-form-item label="Refresh Token（可选）">
                  <n-input v-model:value="createForm.refreshToken" placeholder="refresh_token" />
                </n-form-item>
              </n-gi>
              <n-gi :span="24">
                <n-form-item label="备注（可选）">
                  <n-input v-model:value="createForm.remark" placeholder="备注信息" />
                </n-form-item>
              </n-gi>
            </n-grid>
            <n-space justify="end">
              <n-button type="primary" :loading="createLoading" @click="handleCreateAccount">
                保存账号
              </n-button>
            </n-space>
          </n-card>

          <n-card title="批量导入" size="small">
            <n-input
              v-model:value="importText"
              type="textarea"
              :autosize="{ minRows: 5, maxRows: 9 }"
              placeholder="每行一个账号：账号----密码 或 账号----密码----client_id----refresh_token"
            />
            <template #footer>
              <n-space justify="space-between" align="center" wrap>
                <span class="hint">支持手动输入或 TXT 文件导入，空行会自动忽略。</span>
                <n-space>
                  <input
                    ref="txtFileInputRef"
                    class="hidden-file-input"
                    type="file"
                    accept=".txt,text/plain"
                    @change="handleTxtFileChange"
                  />
                  <n-button secondary :loading="importLoading" @click="triggerTxtImport">
                    导入 TXT
                  </n-button>
                  <n-button type="primary" secondary :loading="importLoading" @click="handleImport">
                    导入文本
                  </n-button>
                </n-space>
              </n-space>
            </template>
          </n-card>

          <n-card title="账号列表" size="small">
            <div class="list-toolbar">
              <div class="list-toolbar-left">
                <n-input
                  v-model:value="searchKeyword"
                  clearable
                  style="max-width: 340px"
                  placeholder="按账号或备注搜索"
                  @keyup.enter="loadAccounts"
                />
                <n-tag type="info" size="small">共 {{ accounts.length }} 条</n-tag>
                <n-tag type="warning" size="small">已选 {{ checkedRowKeys.length }} 条</n-tag>
              </div>
              <div class="list-toolbar-right">
                <n-select
                  v-model:value="mailFetchMode"
                  size="small"
                  :options="mailModeOptions"
                  style="width: 120px"
                />
                <n-button size="small" :loading="syncLoading" @click="handleRefreshAccounts(false)">
                  刷新选中
                </n-button>
                <n-button size="small" :loading="syncLoading" @click="handleRefreshAccounts(true)">
                  刷新全部
                </n-button>
                <n-button size="small" :loading="tableLoading" @click="loadAccounts">刷新列表</n-button>
              </div>
            </div>

            <n-data-table
              class="account-table"
              :columns="accountColumns"
              :data="accounts"
              :row-key="rowKey"
              :loading="tableLoading"
              :checked-row-keys="checkedRowKeys"
              :pagination="tablePagination"
              :scroll-x="1500"
              max-height="520"
              @update:checked-row-keys="handleCheckedRowKeysUpdate"
            />
          </n-card>
        </n-space>
      </n-tab-pane>

      <n-tab-pane name="ingest" tab="上传接口">
        <n-space vertical size="large">
          <n-card title="外部上传接口说明" size="small">
            <div class="api-box">
              <p><strong>接口地址：</strong>{{ ingestEndpointUrl }}</p>
              <p><strong>请求方法：</strong>POST</p>
              <p><strong>Content-Type：</strong>application/json 或 text/plain</p>
              <p><strong>鉴权头：</strong>{{ ingestTokenHeader }}: &lt;INGEST_TOKEN&gt;</p>
            </div>
          </n-card>

          <n-card title="上传字段映射配置" size="small">
            <n-form label-placement="top">
              <n-grid :x-gap="12" :y-gap="12" :cols="24">
                <n-gi :span="8">
                  <n-form-item label="分隔符">
                    <n-input v-model:value="ingestConfig.delimiter" placeholder="----" />
                  </n-form-item>
                </n-gi>
                <n-gi :span="8">
                  <n-form-item label="captcha 行字段名">
                    <n-input v-model:value="ingestConfig.captchaField" placeholder="data" />
                  </n-form-item>
                </n-gi>
                <n-gi :span="8">
                  <n-form-item label="账号字段名">
                    <n-input v-model:value="ingestConfig.accountField" placeholder="a" />
                  </n-form-item>
                </n-gi>
                <n-gi :span="8">
                  <n-form-item label="密码字段名">
                    <n-input v-model:value="ingestConfig.passwordField" placeholder="p" />
                  </n-form-item>
                </n-gi>
                <n-gi :span="8">
                  <n-form-item label="client_id 字段名">
                    <n-input v-model:value="ingestConfig.clientIdField" placeholder="c" />
                  </n-form-item>
                </n-gi>
                <n-gi :span="8">
                  <n-form-item label="refresh_token 字段名">
                    <n-input v-model:value="ingestConfig.tokenField" placeholder="t" />
                  </n-form-item>
                </n-gi>
              </n-grid>
            </n-form>
            <n-space justify="end">
              <n-button type="primary" :loading="saveIngestLoading" @click="handleSaveIngestConfig">
                保存映射配置
              </n-button>
            </n-space>
          </n-card>

          <n-card title="请求示例" size="small">
            <n-space vertical>
              <p class="hint">示例 1（captchaurn 格式）：</p>
              <n-code :code="captchaPayloadExample" language="json" word-wrap />
              <p class="hint">示例 2（字段映射格式）：</p>
              <n-code :code="mappedPayloadExample" language="json" word-wrap />
              <p class="hint">curl 示例：</p>
              <n-code :code="curlExample" language="bash" word-wrap />
            </n-space>
          </n-card>
        </n-space>
      </n-tab-pane>

      <n-tab-pane name="api-docs" tab="API文档">
        <n-space vertical size="large">
          <n-card title="接口总览" size="small">
            <p class="hint">Base URL：{{ apiBaseUrl }}</p>
            <ul class="api-list">
              <li>
                <code>POST /api/upload/ingest</code>
                ：外部平台上传账号到本系统（token 鉴权）。
              </li>
              <li>
                <code>GET /api/open/accounts/:id/messages?mode=graph|imap</code>
                ：按账号 ID 获取全部邮件（开放 API）。
              </li>
              <li>
                <code>POST /api/open/messages</code>
                ：按账号 ID 或邮箱地址获取全部邮件（开放 API）。
              </li>
              <li>
                <code>POST /api/auth/login</code>
                ：后台登录，登录后可调用管理端 API。
              </li>
            </ul>
          </n-card>

          <n-card title="开放取件 API（Token 鉴权）" size="small">
            <n-space vertical>
              <p class="hint">支持 Header：{{ mailApiTokenHeader }} 或 Authorization: Bearer token。</p>
              <p class="hint">按账号 ID 取件：</p>
              <n-code :code="openApiCurlById" language="bash" word-wrap />
              <p class="hint">按邮箱地址取件：</p>
              <n-code :code="openApiCurlByAccount" language="bash" word-wrap />
            </n-space>
          </n-card>

          <n-card title="管理端 API（登录会话）" size="small">
            <n-space vertical>
              <n-code :code="adminApiDoc" language="text" word-wrap />
              <p class="hint">登录并使用 Cookie 调用管理端接口：</p>
              <n-code :code="adminLoginCurl" language="bash" word-wrap />
            </n-space>
          </n-card>
        </n-space>
      </n-tab-pane>
    </n-tabs>

    <n-modal v-model:show="editVisible" preset="card" title="编辑账号" style="max-width: 760px">
      <n-form label-placement="top">
        <n-grid :x-gap="12" :y-gap="12" :cols="24">
          <n-gi :span="12">
            <n-form-item label="账号">
              <n-input v-model:value="editForm.account" />
            </n-form-item>
          </n-gi>
          <n-gi :span="12">
            <n-form-item label="密码">
              <n-input v-model:value="editForm.password" type="password" show-password-on="click" />
            </n-form-item>
          </n-gi>
          <n-gi :span="12">
            <n-form-item label="Client ID">
              <n-input v-model:value="editForm.clientId" />
            </n-form-item>
          </n-gi>
          <n-gi :span="12">
            <n-form-item label="Refresh Token">
              <n-input v-model:value="editForm.refreshToken" />
            </n-form-item>
          </n-gi>
          <n-gi :span="24">
            <n-form-item label="备注">
              <n-input v-model:value="editForm.remark" />
            </n-form-item>
          </n-gi>
        </n-grid>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="editVisible = false">取消</n-button>
          <n-button type="primary" :loading="editLoading" @click="handleUpdateAccount">保存修改</n-button>
        </n-space>
      </template>
    </n-modal>

    <n-modal
      v-model:show="mailVisible"
      preset="card"
      :title="`邮箱取件(${mailCurrentModeLabel}) - ${mailAccount}`"
      style="width: min(1100px, 96vw)"
    >
      <div class="mail-modal-wrapper">
        <div class="mail-list-panel">
          <n-spin :show="mailLoading">
            <n-empty v-if="mailItems.length === 0" description="暂无邮件" />
            <div v-else class="mail-list">
              <button
                v-for="item in mailItems"
                :key="item.id"
                class="mail-item"
                :class="{ 'mail-item-active': selectedMail?.id === item.id }"
                type="button"
                @click="selectedMailId = item.id"
              >
                <p class="mail-item-subject">{{ item.subject || '(无主题)' }}</p>
                <p class="mail-item-meta">{{ item.from || '-' }}</p>
                <p class="mail-item-meta">{{ formatMailDate(item.receivedAt) }}</p>
              </button>
            </div>
          </n-spin>
        </div>
        <div class="mail-content-panel">
          <n-empty v-if="!selectedMail" description="请从左侧选择邮件" />
          <div v-else class="mail-content-block">
            <h3 class="mail-content-title">{{ selectedMail.subject || '(无主题)' }}</h3>
            <p class="mail-content-meta">发件人：{{ selectedMail.from || '-' }}</p>
            <p class="mail-content-meta">时间：{{ formatMailDate(selectedMail.receivedAt) }}</p>
            <div class="mail-content-text">{{ selectedMailText }}</div>
          </div>
        </div>
      </div>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, reactive, ref } from 'vue';
import {
  NButton,
  NCard,
  NCode,
  NDataTable,
  NEmpty,
  NForm,
  NFormItem,
  NGi,
  NGrid,
  NInput,
  NModal,
  NSelect,
  NSpace,
  NSpin,
  NTabPane,
  NTabs,
  NTag,
  createDiscreteApi,
  type DataTableColumns
} from 'naive-ui';
import { api, UnauthorizedError } from './api';
import type {
  AccountItem,
  AccountMailItem,
  AccountPayload,
  BatchActionResult,
  IngestConfig,
  MailFetchMode
} from './types';

const { message } = createDiscreteApi(['message']);

const authLoading = ref(true);
const loginLoading = ref(false);
const logoutLoading = ref(false);
const isAuthenticated = ref(false);
const currentUser = ref('');
const siteOrigin = ref('');

const loginForm = reactive({
  username: 'admin',
  password: ''
});

const activeTab = ref<'accounts' | 'ingest' | 'api-docs'>('accounts');

const accounts = ref<AccountItem[]>([]);
const searchKeyword = ref('');
const checkedRowKeys = ref<number[]>([]);
const tablePageSize = ref<number>(20);

const mailVisible = ref(false);
const mailLoading = ref(false);
const mailAccount = ref('');
const mailFetchMode = ref<MailFetchMode>('graph');
const mailCurrentMode = ref<MailFetchMode>('graph');
const mailItems = ref<AccountMailItem[]>([]);
const selectedMailId = ref('');

const tableLoading = ref(false);
const createLoading = ref(false);
const editLoading = ref(false);
const importLoading = ref(false);
const saveIngestLoading = ref(false);
const syncLoading = ref(false);

const importText = ref('');
const txtFileInputRef = ref<HTMLInputElement | null>(null);

const createForm = reactive<Required<AccountPayload>>({
  account: '',
  password: '',
  clientId: '',
  refreshToken: '',
  remark: ''
});

const editVisible = ref(false);
const editForm = reactive<Required<AccountPayload> & { id: number | null }>({
  id: null,
  account: '',
  password: '',
  clientId: '',
  refreshToken: '',
  remark: ''
});

const ingestConfig = reactive<IngestConfig>({
  delimiter: '----',
  captchaField: 'data',
  accountField: 'a',
  passwordField: 'p',
  clientIdField: 'c',
  tokenField: 't'
});

const ingestEndpointPath = ref('/api/upload/ingest');
const ingestTokenHeader = ref('x-ingest-token');
const mailApiTokenHeader = 'x-mail-api-token';

const rowKey = (row: AccountItem): number => row.id;

function resolveStatusLabel(row: AccountItem): string {
  const status = row.syncStatus || 'idle';
  if (status === 'refresh_success') {
    return '刷新成功';
  }
  if (status === 'refresh_failed') {
    return '刷新失败';
  }
  if (status === 'fetch_success') {
    return `取件成功(${row.fetchedCount ?? 0})`;
  }
  if (status === 'fetch_failed') {
    return '取件失败';
  }
  return '未处理';
}

function resolveStatusType(status: string): 'success' | 'error' | 'warning' | 'default' {
  if (status === 'refresh_success' || status === 'fetch_success') {
    return 'success';
  }
  if (status === 'refresh_failed' || status === 'fetch_failed') {
    return 'error';
  }
  if (status === 'running') {
    return 'warning';
  }
  return 'default';
}

const accountColumns: DataTableColumns<AccountItem> = [
  {
    type: 'selection',
    width: 42
  },
  {
    title: '账号',
    key: 'account',
    minWidth: 220,
    ellipsis: { tooltip: true },
    render: (row) =>
      h(
        NButton,
        {
          text: true,
          type: 'primary',
          onClick: (event: MouseEvent) => {
            event.stopPropagation();
            void handleOpenMailModal(row);
          }
        },
        {
          default: () => row.account
        }
      )
  },
  { title: '密码', key: 'password', minWidth: 170, ellipsis: { tooltip: true } },
  {
    title: 'Client ID',
    key: 'clientId',
    minWidth: 240,
    ellipsis: { tooltip: true },
    render: (row) => row.clientId ?? '-'
  },
  {
    title: 'Refresh Token',
    key: 'refreshToken',
    minWidth: 220,
    ellipsis: { tooltip: true },
    render: (row) => row.refreshToken ?? '-'
  },
  {
    title: '备注',
    key: 'remark',
    minWidth: 130,
    ellipsis: { tooltip: true },
    render: (row) => row.remark ?? '-'
  },
  {
    title: '状态',
    key: 'syncStatus',
    minWidth: 170,
    render: (row) =>
      h(
        NTag,
        {
          size: 'small',
          type: resolveStatusType(row.syncStatus),
          title: row.syncMessage ?? resolveStatusLabel(row)
        },
        {
          default: () => resolveStatusLabel(row)
        }
      )
  },
  { title: '创建时间', key: 'createdAt', minWidth: 180, ellipsis: { tooltip: true } },
  {
    title: '操作',
    key: 'actions',
    width: 130,
    render: (row) =>
      h('div', { class: 'action-cell' }, [
        h(
          NButton,
          {
            size: 'small',
            quaternary: true,
            type: 'primary',
            onClick: () => openEditModal(row)
          },
          { default: () => '编辑' }
        ),
        h(
          NButton,
          {
            size: 'small',
            quaternary: true,
            type: 'error',
            onClick: () => handleDeleteAccount(row.id)
          },
          { default: () => '删除' }
        )
      ])
  }
];

const tablePagination = computed(() => ({
  pageSize: tablePageSize.value,
  showSizePicker: true,
  pageSizes: [10, 20, 50, 100],
  onUpdatePageSize: (size: number) => {
    tablePageSize.value = size;
  }
}));

const selectedMail = computed(() => {
  return mailItems.value.find((item) => item.id === selectedMailId.value) ?? null;
});

const selectedMailText = computed(() => {
  if (!selectedMail.value) {
    return '';
  }

  const content = selectedMail.value.content || selectedMail.value.preview || '';
  if (selectedMail.value.contentType === 'html') {
    return htmlToText(content);
  }
  return content;
});

const mailModeOptions: Array<{ label: string; value: MailFetchMode }> = [
  { label: 'Graph', value: 'graph' },
  { label: 'IMAP', value: 'imap' }
];

const mailCurrentModeLabel = computed(() => (mailCurrentMode.value === 'imap' ? 'IMAP' : 'Graph'));

const apiBaseUrl = computed(() => siteOrigin.value || 'https://your-domain');

const openApiCurlById = computed(() => {
  return `curl "${apiBaseUrl.value}/api/open/accounts/1/messages?mode=graph" \\
  -H "${mailApiTokenHeader}: <MAIL_API_TOKEN>"`;
});

const openApiCurlByAccount = computed(() => {
  return `curl -X POST "${apiBaseUrl.value}/api/open/messages" \\
  -H "Content-Type: application/json" \\
  -H "${mailApiTokenHeader}: <MAIL_API_TOKEN>" \\
  -d '{"account":"example@outlook.com","mode":"imap"}'`;
});

const adminApiDoc = `POST /api/auth/login                     后台管理员登录
POST /api/auth/logout                    退出登录
GET  /api/auth/me                        获取当前登录用户
GET  /api/accounts                       获取账号列表
POST /api/accounts                       新增账号
PUT  /api/accounts/:id                   更新账号
DELETE /api/accounts/:id                 删除账号
POST /api/accounts/import                批量导入账号
POST /api/accounts/refresh               刷新 refresh_token
GET  /api/accounts/:id/messages?mode=... 管理端按账号取件
GET  /api/ingest-config                  获取上传映射配置
PUT  /api/ingest-config                  保存上传映射配置`;

const adminLoginCurl = computed(() => {
  return `curl -c cookie.txt -X POST "${apiBaseUrl.value}/api/auth/login" \\
  -H "Content-Type: application/json" \\
  -d '{"username":"admin","password":"<ADMIN_PASSWORD>"}'

curl -b cookie.txt "${apiBaseUrl.value}/api/accounts"`;
});

const ingestEndpointUrl = computed(() =>
  siteOrigin.value ? `${siteOrigin.value}${ingestEndpointPath.value}` : ingestEndpointPath.value
);

const captchaPayloadExample = computed(() => {
  const key = ingestConfig.captchaField;
  const delimiter = ingestConfig.delimiter;
  const value = `your_account${delimiter}your_password${delimiter}your_client_id${delimiter}your_refresh_token`;
  return JSON.stringify({ [key]: value }, null, 2);
});

const mappedPayloadExample = computed(() =>
  JSON.stringify(
    {
      [ingestConfig.accountField]: 'your_account',
      [ingestConfig.passwordField]: 'your_password',
      [ingestConfig.clientIdField]: 'your_client_id',
      [ingestConfig.tokenField]: 'your_refresh_token'
    },
    null,
    2
  )
);

const curlExample = computed(() => {
  return `curl -X POST '${ingestEndpointUrl.value}' \\
  -H 'Content-Type: application/json' \\
  -H '${ingestTokenHeader.value}: <INGEST_TOKEN>' \\
  -d '${captchaPayloadExample.value.replace(/\n/g, '')}'`;
});

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return '发生未知错误';
}

function clearSessionState(): void {
  isAuthenticated.value = false;
  currentUser.value = '';
  accounts.value = [];
  checkedRowKeys.value = [];
  mailVisible.value = false;
  mailLoading.value = false;
  mailAccount.value = '';
  mailFetchMode.value = 'graph';
  mailCurrentMode.value = 'graph';
  mailItems.value = [];
  selectedMailId.value = '';
  editVisible.value = false;
}

function handleApiError(error: unknown, showAuthWarning = true): void {
  if (error instanceof UnauthorizedError) {
    clearSessionState();
    if (showAuthWarning) {
      message.warning('登录已过期，请重新登录');
    }
    return;
  }

  message.error(getErrorMessage(error));
}

function handleCheckedRowKeysUpdate(keys: Array<number | string>): void {
  checkedRowKeys.value = keys
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);
}

function getTargetAccountIds(all: boolean): number[] {
  if (all) {
    return [];
  }
  return checkedRowKeys.value;
}

function showBatchResult(prefix: string, result: BatchActionResult): void {
  if (result.failure === 0) {
    message.success(`${prefix}完成：成功 ${result.success}/${result.total}`);
  } else {
    message.warning(`${prefix}完成：成功 ${result.success}，失败 ${result.failure}`);
  }
}

function htmlToText(html: string): string {
  if (!html) {
    return '';
  }

  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return (doc.body.textContent || '').trim();
  } catch {
    return html;
  }
}

function formatMailDate(value: string): string {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function normalizePayload(payload: Required<AccountPayload>): AccountPayload {
  return {
    account: payload.account.trim(),
    password: payload.password.trim(),
    clientId: payload.clientId.trim(),
    refreshToken: payload.refreshToken.trim(),
    remark: payload.remark.trim()
  };
}

function clearCreateForm(): void {
  createForm.account = '';
  createForm.password = '';
  createForm.clientId = '';
  createForm.refreshToken = '';
  createForm.remark = '';
}

function openEditModal(row: AccountItem): void {
  editForm.id = row.id;
  editForm.account = row.account;
  editForm.password = row.password;
  editForm.clientId = row.clientId ?? '';
  editForm.refreshToken = row.refreshToken ?? '';
  editForm.remark = row.remark ?? '';
  editVisible.value = true;
}

async function loadAccounts(): Promise<void> {
  tableLoading.value = true;
  try {
    const response = await api.listAccounts(searchKeyword.value.trim());
    accounts.value = response.items;
    const available = new Set(response.items.map((item) => item.id));
    checkedRowKeys.value = checkedRowKeys.value.filter((id) => available.has(id));
  } catch (error) {
    handleApiError(error);
  } finally {
    tableLoading.value = false;
  }
}

async function loadIngestConfig(): Promise<void> {
  try {
    const response = await api.getIngestConfig();
    ingestConfig.delimiter = response.item.delimiter;
    ingestConfig.captchaField = response.item.captchaField;
    ingestConfig.accountField = response.item.accountField;
    ingestConfig.passwordField = response.item.passwordField;
    ingestConfig.clientIdField = response.item.clientIdField;
    ingestConfig.tokenField = response.item.tokenField;
    ingestEndpointPath.value = response.endpointPath;
    ingestTokenHeader.value = response.tokenHeader;
  } catch (error) {
    handleApiError(error);
  }
}

async function loadInitialData(): Promise<void> {
  await Promise.all([loadAccounts(), loadIngestConfig()]);
}

async function handleLogin(): Promise<void> {
  const username = loginForm.username.trim();
  const password = loginForm.password;

  if (!username || !password) {
    message.warning('请填写用户名和密码');
    return;
  }

  loginLoading.value = true;
  try {
    const response = await api.login({ username, password });
    isAuthenticated.value = true;
    currentUser.value = response.username;
    await loadInitialData();
    loginForm.password = '';
    message.success('登录成功');
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      message.error(error.message);
    } else {
      message.error(getErrorMessage(error));
    }
  } finally {
    loginLoading.value = false;
  }
}

async function handleLogout(): Promise<void> {
  logoutLoading.value = true;
  try {
    await api.logout();
    message.success('已退出登录');
  } catch (error) {
    if (!(error instanceof UnauthorizedError)) {
      message.error(getErrorMessage(error));
    }
  } finally {
    logoutLoading.value = false;
    clearSessionState();
    loginForm.password = '';
  }
}

async function handleCreateAccount(): Promise<void> {
  const payload = normalizePayload(createForm);
  if (!payload.account || !payload.password) {
    message.warning('账号和密码必填');
    return;
  }

  createLoading.value = true;
  try {
    await api.createAccount(payload);
    clearCreateForm();
    await loadAccounts();
    message.success('账号已保存');
  } catch (error) {
    handleApiError(error);
  } finally {
    createLoading.value = false;
  }
}

async function handleUpdateAccount(): Promise<void> {
  if (!editForm.id) {
    return;
  }

  const payload = normalizePayload(editForm);
  if (!payload.account || !payload.password) {
    message.warning('账号和密码必填');
    return;
  }

  editLoading.value = true;
  try {
    await api.updateAccount(editForm.id, payload);
    editVisible.value = false;
    await loadAccounts();
    message.success('账号已更新');
  } catch (error) {
    handleApiError(error);
  } finally {
    editLoading.value = false;
  }
}

async function handleDeleteAccount(id: number): Promise<void> {
  const confirmed = window.confirm('确认删除该账号？');
  if (!confirmed) {
    return;
  }

  try {
    await api.deleteAccount(id);
    await loadAccounts();
    message.success('账号已删除');
  } catch (error) {
    handleApiError(error);
  }
}

function triggerTxtImport(): void {
  txtFileInputRef.value?.click();
}

async function handleTxtFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) {
    return;
  }

  try {
    const text = await file.text();
    await importAccountsText(text, `TXT 文件 ${file.name}`);
  } finally {
    input.value = '';
  }
}

async function importAccountsText(rawText: string, sourceLabel: string): Promise<void> {
  const text = rawText.trim();
  if (!text) {
    message.warning(`${sourceLabel} 内容为空`);
    return;
  }

  importLoading.value = true;
  try {
    const result = await api.importAccounts(text);
    await loadAccounts();
    importText.value = '';
    message.success(`${sourceLabel} 导入完成：新增 ${result.inserted}，跳过 ${result.skipped}`);
    if (result.errors.length > 0) {
      message.warning(`有 ${result.errors.length} 行格式错误，已跳过`);
    }
  } catch (error) {
    handleApiError(error);
  } finally {
    importLoading.value = false;
  }
}

async function handleImport(): Promise<void> {
  await importAccountsText(importText.value, '文本内容');
}

async function handleRefreshAccounts(all: boolean): Promise<void> {
  const accountIds = getTargetAccountIds(all);
  if (!all && accountIds.length === 0) {
    message.warning('请先勾选需要刷新的账号');
    return;
  }

  syncLoading.value = true;
  try {
    const result = await api.refreshAccounts({
      accountIds: all ? undefined : accountIds
    });
    await loadAccounts();
    showBatchResult('刷新', result);
  } catch (error) {
    handleApiError(error);
  } finally {
    syncLoading.value = false;
  }
}

async function handleOpenMailModal(row: AccountItem): Promise<void> {
  const mode = mailFetchMode.value;
  mailVisible.value = true;
  mailLoading.value = true;
  mailAccount.value = row.account;
  mailCurrentMode.value = mode;
  mailItems.value = [];
  selectedMailId.value = '';

  try {
    const response = await api.getAccountMessages(row.id, mode);
    mailAccount.value = response.account;
    mailCurrentMode.value = response.mode;
    mailItems.value = response.messages;
    selectedMailId.value = response.messages[0]?.id ?? '';
    await loadAccounts();
  } catch (error) {
    handleApiError(error);
  } finally {
    mailLoading.value = false;
  }
}

async function handleSaveIngestConfig(): Promise<void> {
  saveIngestLoading.value = true;
  try {
    const response = await api.updateIngestConfig({
      delimiter: ingestConfig.delimiter.trim(),
      captchaField: ingestConfig.captchaField.trim(),
      accountField: ingestConfig.accountField.trim(),
      passwordField: ingestConfig.passwordField.trim(),
      clientIdField: ingestConfig.clientIdField.trim(),
      tokenField: ingestConfig.tokenField.trim()
    });
    ingestConfig.delimiter = response.item.delimiter;
    ingestConfig.captchaField = response.item.captchaField;
    ingestConfig.accountField = response.item.accountField;
    ingestConfig.passwordField = response.item.passwordField;
    ingestConfig.clientIdField = response.item.clientIdField;
    ingestConfig.tokenField = response.item.tokenField;
    message.success('上传映射配置已保存');
  } catch (error) {
    handleApiError(error);
  } finally {
    saveIngestLoading.value = false;
  }
}

onMounted(async () => {
  siteOrigin.value = window.location.origin;

  authLoading.value = true;
  try {
    const me = await api.getMe();
    isAuthenticated.value = true;
    currentUser.value = me.username;
    await loadInitialData();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      clearSessionState();
    } else {
      message.error(getErrorMessage(error));
    }
  } finally {
    authLoading.value = false;
  }
});
</script>
