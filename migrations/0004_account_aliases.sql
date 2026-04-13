CREATE TABLE IF NOT EXISTS account_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  alias_email TEXT NOT NULL,
  alias_suffix TEXT NOT NULL,
  remark TEXT,
  is_registered INTEGER NOT NULL DEFAULT 0 CHECK (is_registered IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  UNIQUE(alias_email),
  UNIQUE(account_id, alias_suffix)
);

CREATE INDEX IF NOT EXISTS idx_account_aliases_account_id
ON account_aliases(account_id);
