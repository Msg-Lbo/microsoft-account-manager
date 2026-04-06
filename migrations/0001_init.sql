CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account TEXT NOT NULL,
  password TEXT NOT NULL,
  client_id TEXT,
  refresh_token TEXT,
  remark TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_unique
ON accounts (account, password, IFNULL(client_id, ''), IFNULL(refresh_token, ''));

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO app_settings (key, value)
VALUES (
  'ingest_config',
  '{"delimiter":"----","captchaField":"data","accountField":"a","passwordField":"p","clientIdField":"c","tokenField":"t"}'
);
