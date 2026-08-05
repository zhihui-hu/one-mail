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

OneMail 是一个本地优先的桌面邮件客户端，使用 Tauri 2、Rust、React 和 TypeScript 构建。邮件同步、发送、OAuth、SQLite 数据访问和可选 AI 助手由 Rust 端提供，界面使用 React + Vite。

**语言**：中文 | [English](./README.en.md)

**项目主页 / 下载页**：[https://zhihui-hu.github.io/one-mail/](https://zhihui-hu.github.io/one-mail/)

## ✨ 功能特性

- 📬 **多邮箱账号**：支持 Gmail、Yahoo、阿里邮箱、阿里企业邮箱、189、搜狐、QQ/Foxmail、腾讯企业邮、网易、Outlook/Hotmail、新浪、139、21CN、完美邮箱、iCloud、AOL、Yandex、Mail.ru 和自定义 IMAP/SMTP。
- 🔑 **现代账号授权**：Gmail 支持 Google OAuth 或应用专用密码，Outlook/Hotmail 使用 Microsoft OAuth；OAuth 登录在系统浏览器中完成，并使用 PKCE 和自动续期。
- 🗂️ **IMAP 文件夹选择**：使用密码或授权码的账号可连接服务器发现文件夹；`INBOX` 始终同步，其他可选文件夹按需启用。
- 🧩 **统一收件箱体验**：多账号聚合查看，账号列表展示未读数、同步状态和账号操作。
- 🔎 **本地筛选与搜索**：支持未读、星标、今日、昨日、最近 7 天筛选，并可搜索主题、发件人、摘要和已缓存正文。
- ✅ **本地已读管理**：打开未读邮件后自动更新本地状态，也可批量标记已读。
- 🔄 **Rust 邮件核心**：通过服务商 API 或 IMAP 同步已启用文件夹，通过 SMTP 发送新邮件、回复和转发。
- 📨 **正文按需加载**：点击邮件后再拉取正文，减少启动和同步成本。
- 🛡️ **HTML 安全预览**：净化邮件 HTML，默认阻止远程图片和外部资源。
- 📎 **附件元数据**：正文区域以表格展示接收邮件的附件名称、类型和大小；写信时支持添加本地附件。
- ✍️ **Gmail 风格写信窗口**：支持新邮件、回复、回复全部、转发、抄送/密送、富文本、附件、草稿和发件箱重试。
- 🔐 **本地凭据加密**：邮箱密码、授权码和 OAuth token 使用 AES-256-GCM 加密后保存到本地数据库。
- 💾 **SQLite 本地缓存**：账号、邮件头、正文、附件元数据、搜索索引和设置默认保存在本机。
- ♻️ **原生备份与恢复**：导出一致的 `.onemail` SQLite 快照，并兼容导入旧版 `.sql` 备份。
- 🤖 **可选 AI 助手**：连接 OpenAI-compatible API 后，可自由对话、总结当前邮件、提取待办和起草回复；助手只读，不会执行发送、删除或修改操作。
- 🌐 **中英文界面**：可在设置中切换中文和英文。

---

## 🖥️ 界面概览

OneMail 当前采用三栏桌面布局：

1. **账号栏**：管理邮箱账号，查看未读数，同步单个账号或全部账号。
2. **邮件列表**：展示当前账号或统一收件箱的邮件，顶部提供标签筛选。
3. **阅读区**：展示邮件主题、收发件人、正文、安全预览提示和附件表格。

写信窗口采用贴近 Gmail 的浮层交互：顶部可展开或还原，收件人行可按需展开抄送、密送，底部提供发送、格式栏、附件、链接、保存草稿和丢弃草稿操作。

设置页提供界面语言、远程内容策略、本地备份、AI 连接和关于信息。

首次没有账号时，可以直接添加账号，也可以导入 `.onemail`、兼容的 OneMail `.sqlite` 或旧版 `.sql` 备份。

---

## 🔑 账号授权

- **Gmail**：默认使用系统浏览器完成 Google OAuth；高级选项中也可使用应用专用密码。Google OAuth 运行时需要 `ONEMAIL_GOOGLE_CLIENT_ID`。
- **Outlook / Hotmail**：使用系统浏览器完成 Microsoft OAuth。可通过 `ONEMAIL_MICROSOFT_CLIENT_ID` 覆盖内置桌面客户端 ID。
- **其他内置服务商**：按服务商要求填写密码、应用专用密码、授权码或客户端专用密码。
- **自定义 IMAP**：填写邮箱地址、凭据、IMAP 服务器、端口和安全模式；需要发信时可同时配置 SMTP。
- **文件夹发现**：密码或授权码账号可在保存前测试 IMAP 连接并选择同步文件夹；OAuth 账号当前使用服务商默认同步路径。

---

## 🤖 AI 助手

AI 助手默认未启用，可在 **设置 → AI** 中配置：

- 使用 OpenAI-compatible Chat Completions 接口，填写 Base URL 和模型名称后必须先通过连接验证。
- 远端服务只允许 HTTPS，并需要 API Key；本机 `localhost` 或回环地址可使用 HTTP，且不会使用 API Key。
- API Key 保存在操作系统安全凭据库中，不写入 SQLite 数据库或 `.onemail` 备份。
- 只有用户主动发起请求时，所选邮件的主题、发件人、时间和纯文本内容才会发送给已配置的服务。
- 助手是只读的：可以分析内容和生成草稿，但没有工具权限，也不会直接操作邮件。

---

## 🛠️ 本地开发

### 环境要求

- Node.js 22 或更高版本
- pnpm 10.34.1
- Rust stable 工具链
- 对应平台的 [Tauri 2 系统依赖](https://v2.tauri.app/start/prerequisites/)
- macOS / Windows / Linux 桌面环境

### 安装依赖

```bash
pnpm install
```

### 启动桌面开发模式

```bash
pnpm tauri:dev
# 或
make dev
```

Tauri 会同时启动 Rust 桌面进程和 Vite 开发服务器。若只调试前端页面，可运行 `pnpm dev`。

### 检查与前端构建

```bash
pnpm typecheck
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
```

`pnpm build` 只生成前端静态资源，不会生成桌面安装包。

### 打包与发布

```bash
pnpm tauri:build
```

也可以运行 `make deploy`；该命令会先按上海时区生成版本号并更新 `package.json`，再构建生产安装包。推送 `v*` 标签会触发 GitHub Actions，为 macOS arm64/x64、Windows x64 和 Linux x64 构建 Tauri 包。

---

## 🎯 使用说明

1. **添加邮箱账号**：点击右上角添加按钮，选择常见邮箱服务商或自定义 IMAP。
2. **完成授权**：Gmail/Outlook 可在系统浏览器中完成 OAuth，其他服务商按要求填写密码或授权码。
3. **选择并同步文件夹**：密码或授权码账号可先发现并选择 IMAP 文件夹；保存后自动同步，也可在账号栏手动同步。
4. **筛选与搜索**：使用未读、星标和日期筛选，或输入关键词搜索本地邮件。
5. **本地标记已读**：打开未读邮件后会自动更新本地已读状态，也可批量处理。
6. **阅读正文**：点击邮件后加载正文；HTML 邮件会先以安全预览方式显示。
7. **加载完整内容**：需要查看远程图片时，可在阅读区顶部点击加载完整内容。
8. **查看附件信息**：正文底部会显示接收附件的名称、类型和大小。
9. **撰写和回复**：点击写信、回复、回复全部或转发；可展开抄送/密送、切换格式栏并添加本地附件。
10. **保存或丢弃草稿**：关闭有内容的写信窗口会保存草稿；底部垃圾桶可丢弃已保存草稿。
11. **可选 AI 助手**：在设置中验证自有 AI 服务后，可对话或针对当前邮件执行总结、待办提取和回复起草。
12. **备份数据**：在设置中导出 `.onemail` 备份，并可从本地备份恢复。

---

## 🔐 数据与安全

- OneMail 的数据库位于 Tauri 应用数据目录下的 `OneMail/onemail.sqlite`。
- 邮箱密码、授权码和 OAuth token 不会明文写入数据库，而是使用本地数据库密钥派生的 AES-256-GCM 密钥加密。
- AI API Key 保存在操作系统安全凭据库中；只有用户主动请求时，相关对话和所选邮件内容才会发送到用户配置的 AI 服务。
- `.onemail` 文件是包含完整本地数据库数据和恢复密钥元数据的 SQLite 快照，请按敏感文件妥善保管。
- 导入时会检查 SQLite 完整性、必要表结构、格式版本和备份元数据；旧版 `.sql` 仅作为兼容导入格式保留。
- HTML 邮件会经过基础净化，默认阻止远程图片和外部资源，降低隐私泄露风险。
- 接收附件目前只保存元数据，不会自动写入本地文件。

---

## 🚧 当前限制

- 接收附件下载仍在迁移中；当前只能查看附件元数据。
- 本地已读/未读操作尚未通过 IMAP 回写远端邮箱。
- WebDAV / S3 远端备份尚未迁移；当前可用的是本地 `.onemail` 导入导出和旧 SQL 导入兼容。
- Tauri 自动更新源尚未配置，请从项目主页或 GitHub Releases 获取新版本。
- IMAP 每个已启用文件夹最多同步最近 200 封邮件，Gmail API 初次扫描当前以 `INBOX` 最近 200 封为限；同步间隔、缓存窗口和开机启动设置尚未接入实际系统行为。
- OAuth、IMAP、SMTP、AI 服务连接和系统凭据库的实际可用性取决于真实账号、服务与运行环境，生产使用前请验证。

---

## 📁 项目结构

```text
src/
├── app/                  # React Router 配置
├── components/           # 账号、邮件、AI、备份、设置和 UI 组件
├── features/             # 邮箱工作区与交互逻辑
├── lib/                  # Tauri API 适配、国际化和查询客户端
├── pages/                # 邮箱与添加账号页面
└── shared/               # 前端共享类型和服务商元数据

src-tauri/
├── src/
│   ├── commands/         # 账号、邮件、AI、备份、设置和系统命令
│   ├── ai.rs             # OpenAI-compatible 只读助手
│   ├── db.rs             # SQLite 初始化与连接
│   ├── db/schema.sql     # 数据库结构
│   ├── gmail_api.rs      # Gmail 增量同步适配
│   ├── graph_api.rs      # Microsoft 增量同步适配与回退边界
│   ├── oauth.rs          # Google / Microsoft OAuth
│   ├── mail_sync.rs      # 邮件同步
│   ├── mail_transport.rs # IMAP 连接与凭据处理
│   └── smtp_send.rs      # SMTP 发送
├── capabilities/         # Tauri 权限配置
└── tauri.conf.json       # 桌面窗口与构建配置
```

---

## 📦 技术栈

- [Tauri 2](https://tauri.app/) - 跨平台桌面应用框架
- [Rust](https://www.rust-lang.org/) - 邮件、OAuth、备份与本地数据核心
- [React](https://react.dev/) - 渲染层 UI
- [React Router](https://reactrouter.com/) - 前端路由
- [Vite](https://vite.dev/) - 前端开发与构建工具
- [TypeScript](https://www.typescriptlang.org/) - 类型系统
- [Tailwind CSS](https://tailwindcss.com/) - 原子化样式
- [shadcn/ui](https://ui.shadcn.com/) - UI 组件
- [Lucide React](https://lucide.dev/) - 图标库
- [SQLite](https://www.sqlite.org/) / [rusqlite](https://github.com/rusqlite/rusqlite) - 本地数据存储与原生备份
- [async-imap](https://github.com/async-email/async-imap) / [lettre](https://lettre.rs/) - IMAP 同步与 SMTP 发送

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request。建议在提交前运行：

```bash
pnpm typecheck
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
```

## 📄 许可证

本项目采用 [GNU Affero General Public License v3.0](https://www.gnu.org/licenses/agpl-3.0.html)（AGPL-3.0-only）许可。

你可以在遵守 AGPL v3.0 条款的前提下使用、复制、修改和分发本项目；如果通过网络提供修改后的版本，也需要按 AGPL 要求向用户提供相应源代码。

## 🙏 致谢

- [Tauri](https://tauri.app/) - 桌面应用运行时
- [Rust](https://www.rust-lang.org/) - 原生应用核心
- [React](https://react.dev/) - 界面框架
- [Vite](https://vite.dev/) - 开发构建工具
- [shadcn/ui](https://ui.shadcn.com/) - UI 组件库
- [Lucide](https://lucide.dev/) - 图标库
- [SQLite](https://www.sqlite.org/) - 本地数据库

---

**注意**：Gmail 与 Outlook 优先使用系统浏览器 OAuth；其他服务商通常需要先启用 IMAP/SMTP，并按要求使用应用专用密码、授权码或客户端专用密码。
