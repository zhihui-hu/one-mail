# OneMail

<p align="left">
  <img src="https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white" alt="Tauri 2" />
  <img src="https://img.shields.io/badge/Rust-stable-000000?logo=rust&logoColor=white" alt="Rust stable" />
  <img src="https://img.shields.io/badge/React-19-282C34?logo=react&logoColor=61DAFB" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white" alt="TypeScript 5.9" />
  <img src="https://img.shields.io/badge/Vite-7-646CFF?logo=vite&logoColor=white" alt="Vite 7" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white" alt="Tailwind CSS 4" />
  <img src="https://img.shields.io/badge/SQLite-local-003B57?logo=sqlite&logoColor=white" alt="SQLite" />
  <img src="https://img.shields.io/badge/pnpm-10.34-F69220?logo=pnpm&logoColor=white" alt="pnpm 10.34" />
</p>

OneMail is a local-first desktop mail client built with Tauri 2, Rust, React, and TypeScript. Mail sync, sending, OAuth, SQLite access, and the optional AI assistant run in Rust, while the interface uses React and Vite.

**Language**: [中文](./README.md) | English

**Website / Downloads**: [https://zhihui-hu.github.io/one-mail/](https://zhihui-hu.github.io/one-mail/)

## Features

- **Multiple mail accounts**: supports Gmail, Yahoo, Alibaba Mail, Alibaba Mail Enterprise, 189 Mail, Sohu, QQ/Foxmail, Tencent Enterprise Mail, NetEase Mail, Outlook/Hotmail, Sina, 139 Mail, 21CN, Perfect Mail, iCloud, AOL, Yandex, Mail.ru, and custom IMAP/SMTP.
- **Modern account authorization**: Gmail supports Google OAuth or an app password, while Outlook/Hotmail uses Microsoft OAuth. OAuth runs in the system browser with PKCE and automatic token refresh.
- **IMAP folder selection**: password- and authorization-code accounts can connect to discover folders. `INBOX` is always enabled, and other selectable folders are optional.
- **Unified inbox**: view mail across accounts with unread counts, sync status, and account actions.
- **Local filters and search**: filter by unread, starred, today, yesterday, or the last seven days, and search subjects, senders, snippets, and cached bodies.
- **Local read-state management**: opening an unread message updates its local state, with bulk mark-as-read support.
- **Rust mail core**: sync enabled folders through provider APIs or IMAP, and send new messages, replies, and forwards over SMTP.
- **Lazy body loading**: message bodies load on demand to reduce startup and sync cost.
- **Safe HTML preview**: sanitizes HTML mail and blocks remote images and external resources by default.
- **Attachment metadata**: displays the name, type, and size of received attachments; local files can be attached when composing.
- **Gmail-style composer**: supports new mail, reply, reply all, forward, CC/BCC, rich text, attachments, drafts, and outbox retry.
- **Encrypted local credentials**: mailbox passwords, app passwords, authorization codes, and OAuth tokens are stored with AES-256-GCM encryption.
- **Local SQLite cache**: accounts, headers, bodies, attachment metadata, search indexes, and settings stay on your machine by default.
- **Native backup and restore**: exports a consistent `.onemail` SQLite snapshot and imports compatible legacy `.sql` backups.
- **Optional AI assistant**: connect an OpenAI-compatible API to chat, summarize the current email, extract tasks, or draft a reply. The assistant is read-only and cannot send, delete, or modify mail.
- **Chinese and English UI**: switch languages in Settings.

---

## Interface

OneMail uses a three-column desktop layout:

1. **Account sidebar**: manage mail accounts, view unread counts, and sync one or all accounts.
2. **Message list**: browse the selected account or unified inbox with quick filters.
3. **Reader**: view subject, sender, recipients, safe preview status, message body, and attachments.

The composer is a floating Gmail-like window. It can expand or restore, CC/BCC fields open on demand, and the footer contains send, formatting, attachment, link, save-draft, and discard actions.

Settings include display language, remote-content policy, local backup, AI connection, and app information.

When no account exists, you can add one or import a `.onemail`, compatible OneMail `.sqlite`, or legacy `.sql` backup.

---

## Account Authorization

- **Gmail**: uses Google OAuth in the system browser by default, with an app-password option under Advanced. Google OAuth requires `ONEMAIL_GOOGLE_CLIENT_ID` at runtime.
- **Outlook / Hotmail**: uses Microsoft OAuth in the system browser. `ONEMAIL_MICROSOFT_CLIENT_ID` can override the built-in desktop client ID.
- **Other built-in providers**: enter a password, app password, authorization code, or client-specific password as required by the provider.
- **Custom IMAP**: enter the email address, credentials, IMAP server, port, and security mode. SMTP can also be configured when sending is needed.
- **Folder discovery**: password- and authorization-code accounts can test IMAP and choose folders before saving. OAuth accounts currently use the provider's default sync path.

---

## AI Assistant

The AI assistant is disabled by default. Configure it under **Settings → AI**:

- It uses an OpenAI-compatible Chat Completions endpoint. Enter a base URL and model, then verify the connection before saving.
- Remote services must use HTTPS and require an API key. Local `localhost` or loopback services may use HTTP and do not use an API key.
- The API key is stored in the operating system credential store, not in SQLite or `.onemail` backups.
- The selected email's subject, sender, time, and plain-text content are sent to the configured service only when the user submits a request.
- The assistant is read-only: it can analyze content and generate drafts, but it has no tools and cannot act on mail directly.

---

## Local Development

### Requirements

- Node.js 22 or newer
- pnpm 10.34.1
- Rust stable toolchain
- The platform-specific [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/)
- macOS, Windows, or Linux desktop environment

### Install Dependencies

```bash
pnpm install
```

### Start Desktop Development

```bash
pnpm tauri:dev
# or
make dev
```

Tauri starts the Rust desktop process and the Vite development server together. Run `pnpm dev` only when you need the frontend server by itself.

### Checks and Frontend Build

```bash
pnpm typecheck
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
```

`pnpm build` generates frontend assets only; it does not produce a desktop installer.

### Package and Release

```bash
pnpm tauri:build
```

You can also run `make deploy`. It generates a Shanghai-time version, updates `package.json`, and then builds production bundles. Pushing a `v*` tag triggers GitHub Actions builds for macOS arm64/x64, Windows x64, and Linux x64.

---

## Usage

1. **Add an account**: click the add button and choose a common provider or custom IMAP.
2. **Authorize it**: Gmail and Outlook can complete OAuth in the system browser; other providers use a password or authorization code as required.
3. **Choose and sync folders**: password- and authorization-code accounts can discover and select IMAP folders first. Sync starts after saving and can also be triggered manually.
4. **Filter and search**: use unread, starred, and date filters, or search local mail by keyword.
5. **Mark messages read locally**: opening an unread message updates its local state, and bulk actions are available.
6. **Read mail**: click a message to load its body. HTML mail opens in safe-preview mode first.
7. **Load full content**: click the reader action when you need remote images.
8. **View attachment details**: the reader shows the name, type, and size of received attachments.
9. **Compose and reply**: use compose, reply, reply all, or forward. Expand CC/BCC, toggle formatting tools, and attach local files as needed.
10. **Save or discard drafts**: closing a non-empty composer saves a draft. The trash button discards a saved draft.
11. **Optionally configure AI**: verify your own AI service in Settings, then chat or summarize, extract tasks, and draft replies for the current email.
12. **Back up data**: export a `.onemail` backup in Settings and restore from a local backup.

---

## Data and Security

- The SQLite database is stored at `OneMail/onemail.sqlite` under Tauri's application data directory.
- Mailbox passwords, authorization codes, and OAuth tokens are encrypted with an AES-256-GCM key derived from the local database key.
- The AI API key stays in the operating system credential store. Conversation and selected-email content leave the device only after a user request to the configured AI service.
- A `.onemail` file is a SQLite snapshot containing all local database data and recovery-key metadata. Treat it as a sensitive file.
- Import validates SQLite integrity, required tables, the format version, and backup metadata. Legacy `.sql` remains an import-only compatibility format.
- HTML mail is sanitized. Remote images and external resources are blocked by default to reduce privacy leakage.
- Received attachments are currently stored as metadata only and are not written to local files automatically.

---

## Current Limitations

- Downloading received attachments is still being migrated; only attachment metadata is available today.
- Local read/unread changes are not yet written back to the remote mailbox over IMAP.
- WebDAV and S3 backup are not yet migrated. Local `.onemail` import/export and legacy SQL import are available.
- The Tauri updater source is not configured. Use the project website or GitHub Releases for new versions.
- IMAP sync reads at most the latest 200 messages per enabled folder, and the initial Gmail API scan currently covers the latest 200 messages in `INBOX`. Sync interval, cache-window, and open-at-login settings are not yet wired to system behavior.
- OAuth, IMAP, SMTP, AI-service, and operating-system credential-store behavior depends on real accounts, services, and runtime environments. Verify them before production use.

---

## Project Structure

```text
src/
├── app/                  # React Router configuration
├── components/           # Account, mail, AI, backup, settings, and UI components
├── features/             # Mailbox workspace and interaction logic
├── lib/                  # Tauri API adapter, i18n, and query client
├── pages/                # Mailbox and add-account pages
└── shared/               # Shared frontend types and provider metadata

src-tauri/
├── src/
│   ├── commands/         # Account, message, AI, backup, settings, and system commands
│   ├── ai.rs             # Read-only OpenAI-compatible assistant
│   ├── db.rs             # SQLite initialization and connections
│   ├── db/schema.sql     # Database schema
│   ├── gmail_api.rs      # Gmail incremental-sync adapter
│   ├── graph_api.rs      # Microsoft incremental-sync adapter and fallback boundary
│   ├── oauth.rs          # Google and Microsoft OAuth
│   ├── mail_sync.rs      # Mail synchronization
│   ├── mail_transport.rs # IMAP transport and credential handling
│   └── smtp_send.rs      # SMTP sending
├── capabilities/         # Tauri permissions
└── tauri.conf.json       # Desktop window and build configuration
```

---

## Tech Stack

- [Tauri 2](https://tauri.app/) - cross-platform desktop application framework
- [Rust](https://www.rust-lang.org/) - mail, OAuth, backup, and local-data core
- [React](https://react.dev/) - renderer UI
- [React Router](https://reactrouter.com/) - frontend routing
- [Vite](https://vite.dev/) - frontend development and build tooling
- [TypeScript](https://www.typescriptlang.org/) - type system
- [Tailwind CSS](https://tailwindcss.com/) - utility-first styling
- [shadcn/ui](https://ui.shadcn.com/) - UI components
- [Lucide React](https://lucide.dev/) - icon library
- [SQLite](https://www.sqlite.org/) / [rusqlite](https://github.com/rusqlite/rusqlite) - local storage and native backup
- [async-imap](https://github.com/async-email/async-imap) / [lettre](https://lettre.rs/) - IMAP sync and SMTP sending

---

## Contributing

Issues and pull requests are welcome. Before submitting, please run:

```bash
pnpm typecheck
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
```

## License

OneMail is licensed under the [GNU Affero General Public License v3.0](https://www.gnu.org/licenses/agpl-3.0.html) (AGPL-3.0-only).

You may use, copy, modify, and distribute this project under AGPL v3.0. If you provide a modified version over a network, you must also provide the corresponding source code as required by the AGPL.

## Credits

- [Tauri](https://tauri.app/) - desktop runtime
- [Rust](https://www.rust-lang.org/) - native application core
- [React](https://react.dev/) - interface framework
- [Vite](https://vite.dev/) - development and build tooling
- [shadcn/ui](https://ui.shadcn.com/) - UI component library
- [Lucide](https://lucide.dev/) - icons
- [SQLite](https://www.sqlite.org/) - local database

---

**Note**: Gmail and Outlook prefer OAuth in the system browser. Other providers usually require IMAP/SMTP to be enabled and an app password, authorization code, or client-specific password.
