# OneMail

<p align="left">
  <img src="https://img.shields.io/badge/Electron-39-47848F?logo=electron&logoColor=white" alt="Electron 39" />
  <img src="https://img.shields.io/badge/React-19-282C34?logo=react&logoColor=61DAFB" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white" alt="TypeScript 5.9" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwind-css&logoColor=white" alt="Tailwind CSS 4" />
  <img src="https://img.shields.io/badge/shadcn/ui-black?style=flat&logo=vercel&logoColor=white" alt="shadcn/ui" />
  <img src="https://img.shields.io/badge/Lucide_React-yellow?logo=lucide&logoColor=black" alt="Lucide React" />
  <img src="https://img.shields.io/badge/SQLite-local-003B57?logo=sqlite&logoColor=white" alt="SQLite" />
  <img src="https://img.shields.io/badge/pnpm-orange?logo=pnpm&logoColor=white" alt="pnpm" />
  <img src="https://img.shields.io/badge/Prettier-code_style-F7B93E?logo=prettier&logoColor=black" alt="Prettier" />
</p>

OneMail is a local-first desktop mail client built with Electron, React, and TypeScript. It syncs mail over IMAP into a local SQLite database and provides unified inboxes, mail filters, safe HTML previews, attachment downloads, and SQL backup import/export.

**Language**: [中文](./README.md) | English

**Website / Downloads**: [https://zhihui-hu.github.io/one-mail/](https://zhihui-hu.github.io/one-mail/)

## Features

- **Multiple mail accounts**: supports Gmail, Yahoo, Alibaba Mail, Alibaba Mail Enterprise, 189 Mail, Sohu, QQ/Foxmail, NetEase Mail, Outlook/Hotmail, Sina, 139 Mail, 21CN, Perfect Mail, iCloud, AOL, Yandex, Mail.ru, and custom IMAP.
- **Unified inbox**: view mail across accounts with unread counts, sync status, and account actions.
- **Fast filters**: filter by unread, attachments, starred, today, and more.
- **Read-state sync**: opening an unread message marks it as read locally and syncs the change back over IMAP.
- **Lazy body loading**: message bodies load on demand to reduce startup and sync cost.
- **Safe HTML preview**: sanitizes HTML mail and blocks remote images and external resources by default.
- **Attachment table and download**: view attachment metadata in the message body and choose where to save files.
- **Gmail-style composer**: supports new mail, reply, reply all, forward, CC/BCC expansion, rich text formatting, attachments, and drafts.
- **Encrypted local credentials**: mailbox passwords and app passwords are stored with AES-256-GCM encryption.
- **Local SQLite cache**: accounts, headers, bodies, attachment metadata, search indexes, and settings stay on your machine.
- **SQL backup and restore**: export the current database to SQL, or import a backup during first launch.
- **Configurable sync policy**: control sync interval, cache window, and external image behavior.

---

## Screenshots

<p>
  <img src="https://img.huzhihui.com/2026/05/15/OnaMail-03.webp" alt="OneMail message reader" width="100%" />
</p>

<p>
  <img src="https://img.huzhihui.com/2026/05/15/OnaMail-02.webp" alt="OneMail message list" width="100%" />
</p>

<p>
  <img src="https://img.huzhihui.com/2026/05/15/OnaMail-01.webp" alt="OneMail account management" width="100%" />
</p>

---

## Interface

OneMail uses a three-column desktop layout:

1. **Account sidebar**: manage mail accounts, view unread counts, and sync one or all accounts.
2. **Message list**: browse the selected account or unified inbox with quick filters.
3. **Reader**: view subject, sender, recipients, safe preview status, message body, and attachments.

The composer is a floating Gmail-like window. It can expand or restore, CC/BCC fields open on demand, and the footer contains send, formatting, attachment, link, save draft, and discard actions.

Settings include sync policy, SQL import/export, and app information. The About page shows version, author, GitHub project link, and manual GitHub Release update checks.

When no account exists, you can add an account or restore a SQL backup directly.

---

## Local Development

### Requirements

- Node.js 22 or newer
- pnpm recommended, npm also works
- macOS, Windows, or Linux desktop environment

### Install Dependencies

```bash
pnpm install
# or
npm install
```

### Start Development Mode

```bash
pnpm dev
# or
npm run dev
```

Development mode starts Electron and Vite. The renderer supports hot reload.

### Type Check

```bash
pnpm typecheck
# or
npm run typecheck
```

### Lint

```bash
pnpm lint
# or
npm run lint
```

### Production Build

```bash
pnpm build
# or
npm run build
```

### Package Desktop Apps

```bash
# unpacked output
pnpm build:unpack

# Windows installer
pnpm build:win

# macOS DMG
pnpm build:mac

# Linux AppImage / snap / deb
pnpm build:linux
```

---

## Usage

1. **Add an account**: click the add button and choose a common provider or custom IMAP.
2. **Enter credentials**: built-in providers need email, password/app password/auth code, and optional alias. Custom IMAP also needs server, port, and security mode.
3. **Sync mail**: OneMail starts syncing the inbox after the account is saved. You can also sync manually from the account sidebar.
4. **Filter mail**: use unread, attachment, starred, today, and other filters to narrow the list.
5. **Read mail**: click a message to load its body. HTML mail opens in safe-preview mode first.
6. **Load full content**: click the reader action when you need remote images.
7. **Download attachments**: click an attachment row or download button and choose a save path.
8. **Compose and reply**: use compose, reply, reply all, or forward. CC/BCC expand on demand, and `Aa` toggles formatting tools.
9. **Save or discard drafts**: closing a non-empty composer saves a draft. The trash button discards a saved draft.
10. **Back up data**: export a SQL backup in Settings. Empty first-launch state can import a SQL backup directly.

---

## Data and Security

- The SQLite database is stored under Electron `userData/OneMail/onemail.sqlite`.
- Mailbox passwords, auth codes, and app passwords are encrypted with an AES-256-GCM key derived from the local database key.
- SQL backup files are validated with the key, Linux timestamp, and SQL header information in the filename/content.
- HTML mail is sanitized. Remote images and external resources are blocked by default to reduce privacy leakage.
- Attachments are stored as metadata until you explicitly download them.

---

## Project Structure

```text
src/
├── main/                 # Electron main process, IPC, SQLite, IMAP sync
│   ├── db/               # Database connection, schema, repositories
│   ├── ipc/              # accounts/messages/sync/settings/system IPC
│   ├── mail/             # IMAP sync, body parsing, attachment download
│   └── services/         # Credential encryption, SQL backup, app services
├── preload/              # Safe APIs exposed to the renderer through contextBridge
├── renderer/src/         # React UI
│   ├── components/       # Mail, account, settings, and shadcn/ui components
│   ├── lib/              # Renderer API adapters and utilities
│   └── assets/           # Icons and styles
└── shared/               # Types shared across main, preload, and renderer
```

---

## Tech Stack

- [Electron](https://www.electronjs.org/) - cross-platform desktop runtime
- [electron-vite](https://electron-vite.org/) - Electron + Vite tooling
- [React](https://react.dev/) - renderer UI
- [TypeScript](https://www.typescriptlang.org/) - type system
- [Tailwind CSS](https://tailwindcss.com/) - utility-first styling
- [shadcn/ui](https://ui.shadcn.com/) - UI components
- [Lucide React](https://lucide.dev/) - icon library
- [SQLite](https://www.sqlite.org/) - local data storage

---

## Contributing

Issues and pull requests are welcome. Before submitting, please run:

```bash
pnpm typecheck
pnpm lint
```

## License

OneMail is licensed under the [GNU Affero General Public License v3.0](./LICENSE) (AGPL-3.0-only).

You may use, copy, modify, and distribute this project under AGPL v3.0. If you provide a modified version over a network, you must also provide the corresponding source code as required by the AGPL.

## Credits

- [Electron](https://www.electronjs.org/) - desktop runtime
- [electron-vite](https://electron-vite.org/) - development and build tooling
- [shadcn/ui](https://ui.shadcn.com/) - UI component library
- [Lucide](https://lucide.dev/) - icons
- [SQLite](https://www.sqlite.org/) - local database

---

**Note**: OneMail currently focuses on local IMAP sync and desktop reading. For Gmail, Outlook, QQ, NetEase, Yahoo, iCloud, and similar providers, enable IMAP/SMTP in the provider settings first and use an app password, authorization code, or dedicated password when required.
