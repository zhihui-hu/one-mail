-- ============================================================
-- OneMail SQLite schema
-- Single source of truth for database initialization.
-- This is not a migration file and intentionally has no version.
-- ============================================================


CREATE TABLE IF NOT EXISTS onemail_provider_presets (
  provider_key TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  domains_json TEXT NOT NULL DEFAULT '[]',
  auth_type TEXT NOT NULL CHECK (
    auth_type IN ('oauth2', 'app_password', 'password', 'bridge', 'manual')
  ),
  imap_host TEXT,
  imap_port INTEGER,
  imap_security TEXT CHECK (imap_security IN ('ssl_tls', 'starttls', 'none')),
  smtp_host TEXT,
  smtp_port INTEGER,
  smtp_security TEXT CHECK (smtp_security IN ('ssl_tls', 'starttls', 'none')),
  smtp_auth_type TEXT CHECK (
    smtp_auth_type IN ('oauth2', 'app_password', 'password', 'bridge', 'manual')
  ),
  smtp_requires_auth INTEGER NOT NULL DEFAULT 1 CHECK (smtp_requires_auth IN (0, 1)),
  oauth_provider TEXT,
  oauth_scopes_json TEXT NOT NULL DEFAULT '[]',
  requires_enable_imap INTEGER NOT NULL DEFAULT 1 CHECK (requires_enable_imap IN (0, 1)),
  requires_app_password INTEGER NOT NULL DEFAULT 0 CHECK (requires_app_password IN (0, 1)),
  requires_bridge INTEGER NOT NULL DEFAULT 0 CHECK (requires_bridge IN (0, 1)),
  setup_help_url TEXT,
  notes TEXT,
  is_builtin INTEGER NOT NULL DEFAULT 1 CHECK (is_builtin IN (0, 1)),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS onemail_mail_accounts (
  account_id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_key TEXT NOT NULL,
  email TEXT NOT NULL,
  normalized_email TEXT NOT NULL,
  display_name TEXT,
  account_label TEXT NOT NULL,
  avatar_text TEXT,
  color_key TEXT,
  auth_type TEXT NOT NULL CHECK (
    auth_type IN ('oauth2', 'app_password', 'password', 'bridge', 'manual')
  ),
  imap_host TEXT NOT NULL,
  imap_port INTEGER NOT NULL CHECK (imap_port > 0 AND imap_port <= 65535),
  imap_security TEXT NOT NULL CHECK (imap_security IN ('ssl_tls', 'starttls', 'none')),
  smtp_host TEXT,
  smtp_port INTEGER CHECK (smtp_port IS NULL OR (smtp_port > 0 AND smtp_port <= 65535)),
  smtp_security TEXT CHECK (smtp_security IN ('ssl_tls', 'starttls', 'none')),
  smtp_auth_type TEXT CHECK (
    smtp_auth_type IN ('oauth2', 'app_password', 'password', 'bridge', 'manual')
  ),
  smtp_enabled INTEGER NOT NULL DEFAULT 1 CHECK (smtp_enabled IN (0, 1)),
  sync_enabled INTEGER NOT NULL DEFAULT 1 CHECK (sync_enabled IN (0, 1)),
  sync_interval_minutes INTEGER NOT NULL DEFAULT 15 CHECK (sync_interval_minutes >= 0),
  sync_window_days INTEGER NOT NULL DEFAULT 90 CHECK (sync_window_days > 0),
  encrypted_password TEXT,
  credential_state TEXT NOT NULL DEFAULT 'pending' CHECK (
    credential_state IN ('pending', 'stored', 'invalid', 'expired', 'revoked')
  ),
  status TEXT NOT NULL DEFAULT 'active' CHECK (
    status IN ('active', 'disabled', 'syncing', 'auth_error', 'sync_error', 'network_error')
  ),
  sort_order INTEGER NOT NULL DEFAULT 0,
  last_sync_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (provider_key) REFERENCES onemail_provider_presets(provider_key),
  UNIQUE(provider_key, normalized_email)
);

CREATE TABLE IF NOT EXISTS onemail_oauth_tokens (
  account_id INTEGER PRIMARY KEY,
  provider_key TEXT NOT NULL,
  token_payload TEXT NOT NULL,
  expires_at TEXT,
  scopes_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (account_id) REFERENCES onemail_mail_accounts(account_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS onemail_mail_folders (
  folder_id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  path TEXT NOT NULL,
  name TEXT NOT NULL,
  delimiter TEXT,
  role TEXT NOT NULL DEFAULT 'custom' CHECK (
    role IN ('inbox', 'sent', 'drafts', 'trash', 'junk', 'archive', 'all_mail', 'important', 'starred', 'custom')
  ),
  attributes_json TEXT NOT NULL DEFAULT '[]',
  uid_validity TEXT,
  uid_next INTEGER,
  highest_modseq TEXT,
  total_count INTEGER NOT NULL DEFAULT 0 CHECK (total_count >= 0),
  unread_count INTEGER NOT NULL DEFAULT 0 CHECK (unread_count >= 0),
  is_selectable INTEGER NOT NULL DEFAULT 1 CHECK (is_selectable IN (0, 1)),
  is_subscribed INTEGER NOT NULL DEFAULT 1 CHECK (is_subscribed IN (0, 1)),
  sync_enabled INTEGER NOT NULL DEFAULT 0 CHECK (sync_enabled IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  last_sync_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (account_id) REFERENCES onemail_mail_accounts(account_id) ON DELETE CASCADE,
  UNIQUE(account_id, path)
);

CREATE TABLE IF NOT EXISTS onemail_folder_sync_states (
  folder_id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL,
  last_uid INTEGER NOT NULL DEFAULT 0 CHECK (last_uid >= 0),
  last_internal_date TEXT,
  uid_validity TEXT,
  highest_modseq TEXT,
  last_full_scan_at TEXT,
  last_success_at TEXT,
  last_error TEXT,
  status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'syncing', 'error')),
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (folder_id) REFERENCES onemail_mail_folders(folder_id) ON DELETE CASCADE,
  FOREIGN KEY (account_id) REFERENCES onemail_mail_accounts(account_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS onemail_mail_messages (
  message_id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  folder_id INTEGER NOT NULL,
  uid INTEGER NOT NULL CHECK (uid > 0),
  sequence_no INTEGER,
  modseq TEXT,
  rfc822_message_id TEXT,
  thread_key TEXT,
  in_reply_to TEXT,
  references_header TEXT,
  subject TEXT,
  from_name TEXT,
  from_email TEXT,
  sender_name TEXT,
  sender_email TEXT,
  sent_at TEXT,
  received_at TEXT,
  internal_date TEXT,
  snippet TEXT,
  size_bytes INTEGER NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
  is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
  is_starred INTEGER NOT NULL DEFAULT 0 CHECK (is_starred IN (0, 1)),
  is_answered INTEGER NOT NULL DEFAULT 0 CHECK (is_answered IN (0, 1)),
  is_draft INTEGER NOT NULL DEFAULT 0 CHECK (is_draft IN (0, 1)),
  is_deleted INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0, 1)),
  has_attachments INTEGER NOT NULL DEFAULT 0 CHECK (has_attachments IN (0, 1)),
  has_inline_images INTEGER NOT NULL DEFAULT 0 CHECK (has_inline_images IN (0, 1)),
  body_status TEXT NOT NULL DEFAULT 'none' CHECK (body_status IN ('none', 'loading', 'ready', 'error')),
  body_error TEXT,
  flags_json TEXT NOT NULL DEFAULT '[]',
  labels_json TEXT NOT NULL DEFAULT '[]',
  raw_headers TEXT,
  remote_deleted INTEGER NOT NULL DEFAULT 0 CHECK (remote_deleted IN (0, 1)),
  user_deleted INTEGER NOT NULL DEFAULT 0 CHECK (user_deleted IN (0, 1)),
  user_hidden INTEGER NOT NULL DEFAULT 0 CHECK (user_hidden IN (0, 1)),
  deleted_at TEXT,
  delete_error TEXT,
  last_operation_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (account_id) REFERENCES onemail_mail_accounts(account_id) ON DELETE CASCADE,
  FOREIGN KEY (folder_id) REFERENCES onemail_mail_folders(folder_id) ON DELETE CASCADE,
  UNIQUE(account_id, folder_id, uid)
);

CREATE TABLE IF NOT EXISTS onemail_message_addresses (
  address_id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('from', 'sender', 'to', 'cc', 'bcc', 'reply_to')),
  name TEXT,
  email TEXT NOT NULL,
  normalized_email TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (message_id) REFERENCES onemail_mail_messages(message_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS onemail_message_bodies (
  message_id INTEGER PRIMARY KEY,
  body_text TEXT,
  body_html_sanitized TEXT,
  external_images_blocked INTEGER NOT NULL DEFAULT 1 CHECK (external_images_blocked IN (0, 1)),
  sanitized_at TEXT,
  loaded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (message_id) REFERENCES onemail_mail_messages(message_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS onemail_message_attachments (
  attachment_id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL,
  part_id TEXT,
  content_id TEXT,
  filename TEXT NOT NULL,
  mime_type TEXT,
  content_disposition TEXT CHECK (content_disposition IN ('attachment', 'inline')),
  size_bytes INTEGER NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
  checksum_sha256 TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (message_id) REFERENCES onemail_mail_messages(message_id) ON DELETE CASCADE
);

CREATE VIRTUAL TABLE IF NOT EXISTS onemail_message_search USING fts5(
  message_id UNINDEXED,
  account_id UNINDEXED,
  folder_id UNINDEXED,
  subject,
  from_name,
  from_email,
  snippet,
  body_text,
  tokenize = 'unicode61'
);

CREATE TABLE IF NOT EXISTS onemail_sync_runs (
  sync_run_id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER,
  folder_id INTEGER,
  message_id INTEGER,
  sync_kind TEXT NOT NULL CHECK (
    sync_kind IN ('account', 'folder', 'message_headers', 'message_body', 'attachment')
  ),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'failed', 'cancelled')),
  scanned_count INTEGER NOT NULL DEFAULT 0 CHECK (scanned_count >= 0),
  inserted_count INTEGER NOT NULL DEFAULT 0 CHECK (inserted_count >= 0),
  updated_count INTEGER NOT NULL DEFAULT 0 CHECK (updated_count >= 0),
  deleted_count INTEGER NOT NULL DEFAULT 0 CHECK (deleted_count >= 0),
  error_count INTEGER NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  error_message TEXT,
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  finished_at TEXT,
  FOREIGN KEY (account_id) REFERENCES onemail_mail_accounts(account_id) ON DELETE SET NULL,
  FOREIGN KEY (folder_id) REFERENCES onemail_mail_folders(folder_id) ON DELETE SET NULL,
  FOREIGN KEY (message_id) REFERENCES onemail_mail_messages(message_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS onemail_outbox_messages (
  outbox_id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  related_message_id INTEGER,
  compose_kind TEXT NOT NULL CHECK (compose_kind IN ('new', 'reply', 'reply_all', 'forward')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (
    status IN ('draft', 'queued', 'sending', 'sent', 'failed', 'cancelled', 'deleted')
  ),
  rfc822_message_id TEXT NOT NULL,
  in_reply_to TEXT,
  references_header TEXT,
  from_name TEXT,
  from_email TEXT NOT NULL,
  to_json TEXT NOT NULL DEFAULT '[]',
  cc_json TEXT NOT NULL DEFAULT '[]',
  bcc_json TEXT NOT NULL DEFAULT '[]',
  subject TEXT,
  body_text TEXT,
  body_html TEXT,
  raw_mime TEXT,
  remote_sent_folder_id INTEGER,
  remote_sent_uid INTEGER,
  sent_at TEXT,
  deleted_at TEXT,
  last_error TEXT,
  last_warning TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (account_id) REFERENCES onemail_mail_accounts(account_id) ON DELETE CASCADE,
  FOREIGN KEY (related_message_id) REFERENCES onemail_mail_messages(message_id) ON DELETE SET NULL,
  FOREIGN KEY (remote_sent_folder_id) REFERENCES onemail_mail_folders(folder_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS onemail_outbox_attachments (
  attachment_id INTEGER PRIMARY KEY AUTOINCREMENT,
  outbox_id INTEGER NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('local_file', 'forwarded_attachment')),
  source_message_id INTEGER,
  source_attachment_id INTEGER,
  file_path TEXT,
  filename TEXT NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
  content_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (outbox_id) REFERENCES onemail_outbox_messages(outbox_id) ON DELETE CASCADE,
  FOREIGN KEY (source_message_id) REFERENCES onemail_mail_messages(message_id) ON DELETE SET NULL,
  FOREIGN KEY (source_attachment_id) REFERENCES onemail_message_attachments(attachment_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS onemail_message_operations (
  operation_id INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_batch_id TEXT,
  message_id INTEGER,
  outbox_id INTEGER,
  account_id INTEGER NOT NULL,
  operation_kind TEXT NOT NULL CHECK (
    operation_kind IN (
      'send',
      'reply',
      'reply_all',
      'forward',
      'delete',
      'restore',
      'permanent_delete',
      'append_sent',
      'mark_answered'
    )
  ),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'running', 'success', 'failed', 'cancelled')
  ),
  remote_action TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (message_id) REFERENCES onemail_mail_messages(message_id) ON DELETE SET NULL,
  FOREIGN KEY (outbox_id) REFERENCES onemail_outbox_messages(outbox_id) ON DELETE SET NULL,
  FOREIGN KEY (account_id) REFERENCES onemail_mail_accounts(account_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS onemail_app_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL,
  value_type TEXT NOT NULL DEFAULT 'string' CHECK (value_type IN ('string', 'number', 'boolean', 'json')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
