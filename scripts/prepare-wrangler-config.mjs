import fs from 'node:fs';
import path from 'node:path';

const SOURCE_FILE = 'wrangler.toml';
const OUTPUT_FILE = '.wrangler.deploy.toml';
const PLACEHOLDER_ID = 'REPLACE_WITH_YOUR_D1_DATABASE_ID';

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

fs.writeFileSync(outputPath, renderedContent, 'utf8');

const maskedId =
  resolvedId.length > 12
    ? `${resolvedId.slice(0, 8)}...${resolvedId.slice(-4)}`
    : resolvedId;

console.log(`[prepare:cf-config] 已生成 ${OUTPUT_FILE}`);
console.log(`[prepare:cf-config] 使用 database_id: ${maskedId}`);
