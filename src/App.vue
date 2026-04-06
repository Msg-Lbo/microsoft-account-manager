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
              <n-space justify="space-between" align="center">
                <span class="hint">空行会自动忽略，重复账号记录会跳过。</span>
                <n-button type="primary" secondary :loading="importLoading" @click="handleImport">
                  导入账号
                </n-button>
              </n-space>
            </template>
          </n-card>

          <n-card title="账号列表" size="small">
            <n-space justify="space-between" align="center" style="margin-bottom: 12px">
              <n-input
                v-model:value="searchKeyword"
                clearable
                style="max-width: 340px"
                placeholder="按账号或备注搜索"
                @keyup.enter="loadAccounts"
              />
              <n-button :loading="tableLoading" @click="loadAccounts">刷新</n-button>
            </n-space>

            <n-data-table
              :columns="accountColumns"
              :data="accounts"
              :row-key="rowKey"
              :loading="tableLoading"
              :pagination="{ pageSize: 10 }"
              max-height="520"
            />
          </n-card>
        </n-space>
      </n-tab-pane>

      <n-tab-pane name="ingest" tab="上传接口">
        <n-space vertical size="large">
          <n-card title="外部上传接口说明" size="small">
            <n-alert type="info" show-icon>
              把外部系统的账号数据 POST 到本系统，不再需要“本系统推送到外部”。
            </n-alert>
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
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, reactive, ref } from 'vue';
import {
  NAlert,
  NButton,
  NCard,
  NCode,
  NDataTable,
  NForm,
  NFormItem,
  NGi,
  NGrid,
  NInput,
  NModal,
  NSpace,
  NSpin,
  NTabPane,
  NTabs,
  NTag,
  createDiscreteApi,
  type DataTableColumns
} from 'naive-ui';
import { api, UnauthorizedError } from './api';
import type { AccountItem, AccountPayload, IngestConfig } from './types';

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

const activeTab = ref<'accounts' | 'ingest'>('accounts');

const accounts = ref<AccountItem[]>([]);
const searchKeyword = ref('');

const tableLoading = ref(false);
const createLoading = ref(false);
const editLoading = ref(false);
const importLoading = ref(false);
const saveIngestLoading = ref(false);

const importText = ref('');

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

const rowKey = (row: AccountItem): number => row.id;

const accountColumns: DataTableColumns<AccountItem> = [
  { title: '账号', key: 'account', minWidth: 130 },
  { title: '密码', key: 'password', minWidth: 130 },
  {
    title: 'Client ID',
    key: 'clientId',
    minWidth: 150,
    render: (row) => row.clientId ?? '-'
  },
  {
    title: 'Refresh Token',
    key: 'refreshToken',
    minWidth: 180,
    ellipsis: { tooltip: true },
    render: (row) => row.refreshToken ?? '-'
  },
  {
    title: '备注',
    key: 'remark',
    minWidth: 140,
    render: (row) => row.remark ?? '-'
  },
  { title: '创建时间', key: 'createdAt', minWidth: 165 },
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

async function handleImport(): Promise<void> {
  const text = importText.value.trim();
  if (!text) {
    message.warning('请先输入导入内容');
    return;
  }

  importLoading.value = true;
  try {
    const result = await api.importAccounts(text);
    await loadAccounts();
    importText.value = '';
    message.success(`导入完成：新增 ${result.inserted}，跳过 ${result.skipped}`);
    if (result.errors.length > 0) {
      message.warning(`有 ${result.errors.length} 行格式错误，已跳过`);
    }
  } catch (error) {
    handleApiError(error);
  } finally {
    importLoading.value = false;
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
