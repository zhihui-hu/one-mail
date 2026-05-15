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

OneMail 是一个本地优先的桌面邮件客户端，使用 Electron + React + TypeScript 构建。它通过 IMAP 同步邮件到本地 SQLite，支持多邮箱聚合、邮件筛选、正文安全预览、附件下载和 SQL 备份导入导出。

中文

## ✨ 功能特性

- 📬 **多邮箱账号**：支持 Gmail、Outlook、163 邮箱、QQ 邮箱和自定义 IMAP。
- 🧩 **统一收件箱体验**：多账号聚合查看，账号列表展示未读数、同步状态和账号操作。
- 🔎 **邮件快速筛选**：支持未读、有附件、星标、今日等组合筛选。
- ✅ **已读状态同步**：打开未读邮件后自动标记已读，并通过 IMAP 同步到远端邮箱。
- 📨 **正文按需加载**：点击邮件后再拉取正文，减少启动和同步成本。
- 🛡️ **HTML 安全预览**：净化邮件 HTML，默认阻止远程图片和外部资源。
- 📎 **附件表格与下载**：正文区域以表格展示附件元数据，点击即可选择路径下载。
- 🔐 **本地凭据加密**：邮箱密码或授权码使用 AES-256-GCM 加密后保存到本地数据库。
- 💾 **SQLite 本地缓存**：账号、邮件头、正文、附件元数据、搜索索引和设置均保存在本机。
- ♻️ **安全备份导入导出**：支持导出当前数据库为 SQL 文件，也可在首次启动时直接导入 SQL 备份。
- ⚙️ **可配置同步策略**：可设置同步间隔、缓存窗口和外部图片策略。

---

## 📸 预览图

<p>
  <img src="https://img.huzhihui.com/2026/05/15/OnaMail-03.webp" alt="OneMail 邮件阅读预览" width="100%" />
</p>

<p>
  <img src="https://img.huzhihui.com/2026/05/15/OnaMail-02.webp" alt="OneMail 邮件列表预览" width="100%" />
</p>

<p>
  <img src="https://img.huzhihui.com/2026/05/15/OnaMail-01.webp" alt="OneMail 账号管理预览" width="100%" />
</p>

---

## 🖥️ 界面概览

OneMail 当前采用三栏桌面布局：

1. **账号栏**：管理邮箱账号，查看未读数，同步单个账号或全部账号。
2. **邮件列表**：展示当前账号或统一收件箱的邮件，顶部提供标签筛选。
3. **阅读区**：展示邮件主题、收发件人、正文、安全预览提示和附件表格。

首次没有账号时，可以直接添加账号，也可以通过 **导入 SQL** 恢复已有备份。

---

## 🛠️ 本地开发

### 环境要求

- Node.js 22 或更高版本
- pnpm（推荐）或 npm
- macOS / Windows / Linux 桌面环境

### 安装依赖

```bash
pnpm install
# 或
npm install
```

### 启动开发模式

```bash
pnpm dev
# 或
npm run dev
```

开发模式会启动 Electron + Vite，渲染层支持热更新。

### 类型检查

```bash
pnpm typecheck
# 或
npm run typecheck
```

### 代码检查

```bash
pnpm lint
# 或
npm run lint
```

### 构建生产版本

```bash
pnpm build
# 或
npm run build
```

### 打包桌面应用

```bash
# 生成未打包目录
pnpm build:unpack

# Windows 安装包
pnpm build:win

# macOS DMG
pnpm build:mac

# Linux AppImage / snap / deb
pnpm build:linux
```

---

## 🎯 使用说明

1. **添加邮箱账号**：点击右上角添加按钮，选择 Gmail、Outlook、163、QQ 或自定义 IMAP。
2. **填写凭据**：内置邮箱只需填写邮箱、密码/授权码和可选别名；自定义 IMAP 需要填写服务器、端口和安全模式。
3. **同步邮件**：新增账号后会自动同步收件箱，也可以在账号栏手动同步。
4. **筛选邮件**：使用未读、有附件、星标、今日标签快速缩小邮件范围。
5. **自动标记已读**：打开未读邮件后会自动标记已读，并同步到远端邮箱。
6. **阅读正文**：点击邮件后加载正文；HTML 邮件会先以安全预览方式显示。
7. **加载完整内容**：需要查看远程图片时，可在阅读区顶部点击加载完整内容。
8. **下载附件**：在正文底部附件表格中点击附件行或下载按钮，选择保存路径。
9. **备份数据**：在设置中导出 SQL 备份；无账号空状态也可以直接导入 SQL 备份。

---

## 🔐 数据与安全

- OneMail 的数据库文件位于 Electron `userData/OneMail/onemail.sqlite`。
- 邮箱密码或授权码不会明文写入数据库，会使用本地数据库密钥派生的 AES-256-GCM 密钥加密。
- SQL 备份文件会校验文件名中的密钥、Linux 时间戳和 SQL 头部信息。
- HTML 邮件会经过基础净化，默认阻止远程图片和外部资源，降低隐私泄露风险。
- 附件默认只保存元数据，只有用户点击下载时才写入本地文件。

---

## 📁 项目结构

```text
src/
├── main/                 # Electron 主进程、IPC、SQLite、IMAP 同步
│   ├── db/               # 数据库连接、schema、repositories
│   ├── ipc/              # accounts/messages/sync/settings/system IPC
│   ├── mail/             # IMAP 同步、正文解析、附件下载
│   └── services/         # 凭据加密、SQL 备份等服务
├── preload/              # contextBridge 暴露给渲染进程的安全 API
├── renderer/src/         # React UI
│   ├── components/       # 邮件、账号、设置和 shadcn/ui 组件
│   ├── lib/              # 渲染层 API 适配和工具函数
│   └── assets/           # 图标和样式资源
└── shared/               # 主进程、preload、渲染进程共享类型
```

---

## 📦 技术栈

- [Electron](https://www.electronjs.org/) - 跨平台桌面应用框架
- [electron-vite](https://electron-vite.org/) - Electron + Vite 开发构建工具
- [React](https://react.dev/) - 渲染层 UI
- [TypeScript](https://www.typescriptlang.org/) - 类型系统
- [Tailwind CSS](https://tailwindcss.com/) - 原子化样式
- [shadcn/ui](https://ui.shadcn.com/) - UI 组件
- [Lucide React](https://lucide.dev/) - 图标库
- [SQLite](https://www.sqlite.org/) - 本地数据存储

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request。建议在提交前运行：

```bash
pnpm typecheck
pnpm lint
```

## 📄 许可证

当前仓库尚未声明许可证。如需开源分发，请先补充 `LICENSE` 文件。

## 🙏 致谢

- [Electron](https://www.electronjs.org/) - 桌面应用运行时
- [electron-vite](https://electron-vite.org/) - 开发构建工具
- [shadcn/ui](https://ui.shadcn.com/) - UI 组件库
- [Lucide](https://lucide.dev/) - 图标库
- [SQLite](https://www.sqlite.org/) - 本地数据库

---

**注意**：OneMail 目前以本地 IMAP 邮件同步和桌面阅读为核心能力。使用 Gmail、Outlook、QQ、163 等服务时，请先在邮箱后台开启 IMAP，并按服务商要求使用应用专用密码或授权码。
