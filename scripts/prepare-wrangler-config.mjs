import fs from 'node:fs';
import path from 'node:path';

const SOURCE_FILE = 'wrangler.toml';
const OUTPUT_FILE = '.wrangler.deploy.toml';
const PLACEHOLDER_ID = 'REPLACE_WITH_YOUR_D1_DATABASE_ID';
const RUNTIME_ENV_KEYS = [
  'ADMIN_USERNAME',
  'ADMIN_PASSWORD',
  'SESSION_SECRET',
  'INGEST_TOKEN',
  'MAIL_API_TOKEN'
];

const sourcePath = path.resolve(process.cwd(), SOURCE_FILE);
const outputPath = path.resolve(process.cwd(), OUTPUT_FILE);

if (!fs.existsSync(sourcePath)) {
  throw new Error(`未找到配置文件: ${SOURCE_FILE}`);
}

const sourceContent = fs.readFileSync(sourcePath, 'utf8');
const match = sourceContent.match(/^\s*database_id\s*=\s*"([^"]*)"\s*$/m);
if (!match) {
  throw new Error('wrangler.toml 缺少 database_id 配置');
}

const envId = (process.env.D1_DATABASE_ID || '').trim();
const fileId = (match[1] || '').trim();

const resolvedId = envId || (fileId && fileId !== PLACEHOLDER_ID ? fileId : '');
if (!resolvedId) {
  throw new Error(
    '未找到可用的 D1 database_id。请设置环境变量 D1_DATABASE_ID，或在 wrangler.toml 写入真实 database_id。'
  );
}

const renderedContent = sourceContent.replace(
  /^\s*database_id\s*=\s*"[^"]*"\s*$/m,
  `database_id = "${resolvedId}"`
);

const runtimeVars = Object.fromEntries(
  RUNTIME_ENV_KEYS.map((key) => [key, (process.env[key] || '').trim()]).filter(([, value]) => value)
);

const finalContent = upsertVarsSection(renderedContent, runtimeVars);

fs.writeFileSync(outputPath, finalContent, 'utf8');

const maskedId =
  resolvedId.length > 12
    ? `${resolvedId.slice(0, 8)}...${resolvedId.slice(-4)}`
    : resolvedId;

console.log(`[prepare:cf-config] 已生成 ${OUTPUT_FILE}`);
console.log(`[prepare:cf-config] 使用 database_id: ${maskedId}`);
if (Object.keys(runtimeVars).length > 0) {
  console.log(
    `[prepare:cf-config] 已注入运行时变量: ${Object.keys(runtimeVars)
      .map((key) => key)
      .join(', ')}`
  );
}

function upsertVarsSection(content, runtimeVars) {
  const entries = Object.entries(runtimeVars);
  if (entries.length === 0) {
    return content;
  }

  const lines = content.split(/\r?\n/);
  let varsStartIndex = lines.findIndex((line) => line.trim() === '[vars]');

  if (varsStartIndex === -1) {
    const insertAt = lines.findIndex((line) => line.trim().startsWith('['));
    varsStartIndex = insertAt === -1 ? lines.length : insertAt;
    lines.splice(varsStartIndex, 0, '[vars]');
  }

  let varsEndIndex = varsStartIndex + 1;
  while (varsEndIndex < lines.length && !lines[varsEndIndex].trim().startsWith('[')) {
    varsEndIndex += 1;
  }

  const existingSectionLines = lines.slice(varsStartIndex + 1, varsEndIndex);
  const valueByKey = new Map();
  const keyOrder = [];

  for (const line of existingSectionLines) {
    const matched = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"(.*)"\s*$/);
    if (!matched) {
      continue;
    }

    const key = matched[1];
    const value = matched[2] || '';
    if (!valueByKey.has(key)) {
      keyOrder.push(key);
    }
    valueByKey.set(key, value);
  }

  for (const [key, value] of entries) {
    if (!valueByKey.has(key)) {
      keyOrder.push(key);
    }
    valueByKey.set(key, value);
  }

  const sectionLines = keyOrder.map((key) => `${key} = "${escapeTomlString(valueByKey.get(key) || '')}"`);
  lines.splice(varsStartIndex + 1, varsEndIndex - varsStartIndex - 1, ...sectionLines);

  return lines.join('\n');
}

function escapeTomlString(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
