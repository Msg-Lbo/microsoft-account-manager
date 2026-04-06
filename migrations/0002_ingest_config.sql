INSERT OR IGNORE INTO app_settings (key, value)
VALUES (
  'ingest_config',
  '{"delimiter":"----","captchaField":"data","accountField":"a","passwordField":"p","clientIdField":"c","tokenField":"t"}'
);

DELETE FROM app_settings WHERE key = 'upload_config';
