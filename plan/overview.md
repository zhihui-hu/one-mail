# OneMail V1 可执行设计

## 1. 产品边界

V1 只做一件事：多平台、多账号、安全地看邮件。

必须做：

- 支持多个邮箱账号：Gmail、Outlook、163、自定义 IMAP。
- 第一栏展示账号列表，不展开复杂文件夹树。
- 第二栏展示邮件列表，顶部用可多选 Tag 筛选：未读、有附件、星标、今日。
- 第三栏展示邮件正文、收发件人、时间、附件元数据。
- 新增账号、编辑账号、删除账号、设置、安全选项全部通过弹窗完成。
- 弹窗使用 shadcn/ui 的 responsive dialog 模式：桌面 Dialog，窄屏 Drawer。
- SQLite 建表语句负责本地缓存、同步状态和邮件数据结构。
- 邮箱凭据只以加密包存入本地数据库，数据库不保存明文；本机随机生成数据密钥并用系统安全存储保护，用户不需要提供密钥。

明确不做：

- 不发邮件，不做回复、转发、草稿、发件箱。
- 不做 SMTP 配置。
- 不修改远程状态：不标已读、不删除、不移动、不归档。
- 不做规则、AI 分类、多设备同步、团队协作。

## 2. 主界面层级

主界面固定三栏，没有顶部全局操作栏。账号和设置入口放在第一栏，筛选入口放在第二栏顶部。

```txt
┌────────────────┬────────────────────────┬──────────────────────────────┐
│ 第一栏：账号    │ 第二栏：邮件列表         │ 第三栏：邮件正文               │
│                │                        │                              │
│ OneMail        │ [未读][附件][星标][今日] │ 邮件标题                       │
│ [+] [设置]     │ 搜索框                  │ 发件人 / 收件人 / 时间          │
│                │                        │                              │
│ 全部账号  128   │ Alice           10:21   │ HTML 安全正文 / 纯文本 fallback │
│ Gmail 工作 54   │ 项目报价确认       📎   │                              │
│ Outlook   36   │ 摘要文本...             │ 附件列表                       │
│ 163       38   │                        │                              │
└────────────────┴────────────────────────┴──────────────────────────────┘
```

### 第一栏：账号列表

职责：

- 展示 `全部账号` 聚合项。
- 展示每个账号的名称、邮箱、未读数、同步状态。
- 提供新增账号和设置按钮。
- 点击账号后，第二栏邮件列表切换到该账号范围。

不在第一版展开文件夹树。文件夹仍然同步并存库，但 UI 第一版只按账号聚合看邮件。

### 第二栏：邮件列表

顶部筛选使用可多选 `FilterTag`。因为筛选条件可以叠加，例如同时选择 `未读` 和 `有附件`。实现上使用 shadcn `ToggleGroup type="multiple"` 承载多选状态，但视觉表现为 tag/chip。

- 未读：`is_read = 0`。
- 有附件：`has_attachments = 1`。
- 星标：`is_starred = 1`，V1 只显示远程已有星标，不提供修改。
- 今日：按本地日期筛选 `received_at` 或 `internal_date`。

没有选中任何 Tag 时就是全部邮件。

列表项展示：

- 发件人
- 主题
- 摘要
- 时间
- 所属账号
- 未读状态
- 附件标识

### 第三栏：邮件正文

职责：

- 展示标题、发件人、收件人、时间。
- 展示净化后的 HTML 正文。
- 没有 HTML 时展示纯文本。
- 外部图片默认阻断。
- 链接用系统浏览器打开。
- 附件只展示元数据，下载/打开以后再做。

## 3. 弹窗规范

所有非主阅读流操作都用弹窗完成：

- 新增账号
- 编辑账号
- 删除账号确认
- 设置
- 同步错误详情
- 附件打开确认
- HTML 外部图片加载确认

使用 shadcn/ui 的 responsive dialog 模式：

- 桌面端：`Dialog`
- 窄屏端：`Drawer`
- 统一封装为 `ResponsiveDialog`

组件建议：

```txt
components/
  responsive-dialog.tsx
  account/
    account-list.tsx
    add-account-dialog.tsx
    edit-account-dialog.tsx
    remove-account-dialog.tsx
  mail/
    mail-list.tsx
    mail-filter-tags.tsx
    mail-reader.tsx
    attachment-list.tsx
  settings/
    settings-dialog.tsx
```

shadcn 组件使用：

- `Dialog` + `Drawer`：responsive dialog。
- `ToggleGroup` + `ToggleGroupItem`：第二栏顶部可多选 FilterTag 筛选，样式表现为 tag/chip。
- `ScrollArea`：账号列表、邮件列表、正文滚动。
- `Field`、`Input`、`Select`、`Switch`：账号和设置表单。
- `Badge`：未读数、状态、附件。
- `Button`：工具按钮。

## 4. 新增账号表单

新增邮箱时先选择邮箱类型，再根据 `onemail_provider_presets.user_fields_json` 渲染用户需要填写的字段。固定字段不要暴露给普通用户填写，内置邮箱的 IMAP 地址、端口和加密方式由 preset 直接写死；用户通常只关心邮箱、密码或授权、以及一个可选别名。

内置邮箱账号：

- Gmail：V1 后续走 OAuth，用户只选择 Gmail 并完成授权；别名可选。
- Outlook：V1 后续走 OAuth，用户只选择 Outlook 并完成授权；别名可选。
- 163：用户填写邮箱、授权码/客户端专用密码、别名；IMAP 地址、端口、加密方式使用 preset 固定值。
- 自定义 IMAP：用户填写邮箱、密码、别名、IMAP 地址、端口、加密方式；这是唯一需要用户看到服务器地址和端口的类型。

字段规则：

- `email`：必填，统一 trim、转小写后写入 `normalized_email`。
- `password`：密码或授权码字段，必填；只进入加密 payload，不明文写入 SQLite。
- `account_label`：别名，可选；未填写时使用邮箱地址作为别名，落库到 `onemail_mail_accounts.account_label` 时必须已经有值。
- `imap_host`、`imap_port`、`imap_security`：内置 provider 从 preset 读取并写入账号表；自定义 IMAP 才允许用户填写。
- `auth_type` / `credential_kind`：由 provider preset 决定，普通用户不需要选择。

新增账号提交 payload 建议：

```ts
type CreateAccountInput =
  | {
      providerKey: 'gmail' | 'outlook'
      email: string
      accountLabel?: string
      oauthCode: string
    }
  | {
      providerKey: '163'
      email: string
      password: string
      accountLabel?: string
    }
  | {
      providerKey: 'custom_imap'
      email: string
      password: string
      accountLabel?: string
      imapHost: string
      imapPort: number
      imapSecurity: 'ssl_tls' | 'starttls' | 'none'
    }
```

主进程创建账号时负责：

1. 根据 `providerKey` 读取 preset。
2. 合并用户输入和 preset 固定字段，内置 provider 不接受客户端提交的 IMAP host/port/security 覆盖。
3. 计算 `account_label = trim(accountLabel) || normalized_email`。
4. 验证 IMAP 或 OAuth 授权。
5. 将密码、授权码或 token 加密后写入 `onemail_account_credentials`。

## 5. 数据库设计原则

数据库文档是建表 SQL，不是带执行动作的 init 脚本。V1 的 `plan/schema.sql` 应满足：

- 可重复执行：所有表使用 `IF NOT EXISTS`。
- 迁移可追踪：`onemail_schema_migrations` 作为后续迁移记录表。
- 本地 SQLite 友好：表结构明确，索引、种子数据、触发器和视图后续单独拆文件。
- 凭据安全：不存 token、授权码、密码明文；凭据通过 `onemail_crypto_keys` 记录的本机随机数据密钥加密后写入 `onemail_account_credentials`，数据密钥本身由系统安全存储保护。
- 写入幂等：邮件用 `(account_id, folder_id, uid)` 唯一约束防重复。
- 正文延迟：邮件列表主表不放正文，正文按需放 `onemail_message_bodies`。
- 附件延迟：附件先存元数据，不默认落本地文件。
- 搜索可扩展：使用 FTS5 建本地搜索索引。
- 表单可配置：`onemail_provider_presets.user_fields_json` 声明新增账号时用户需要看到的字段；内置 provider 的 IMAP host/port/security 固定在 preset 中，只有自定义 IMAP 暴露这些字段。
- 别名稳定：`onemail_mail_accounts.account_label` 是最终显示名，UI 可选但落库必填；未填写时由主进程使用邮箱地址补齐。

核心表：

- `onemail_provider_presets`
- `onemail_crypto_keys`
- `onemail_mail_accounts`
- `onemail_account_credentials`
- `onemail_mail_folders`
- `onemail_folder_sync_states`
- `onemail_mail_messages`
- `onemail_message_addresses`
- `onemail_message_bodies`
- `onemail_message_attachments`
- `onemail_message_search`
- `onemail_sync_runs`
- `onemail_app_settings`

## 6. 主进程设计

建议目录：

```txt
src/main/
  db/
    connection.ts
    migrate.ts
    repositories/
      account.repository.ts
      message.repository.ts
      sync.repository.ts
  crypto/
    credential-vault.service.ts
  mail/
    imap-client.ts
    folder-sync.ts
    message-sync.ts
    body-loader.ts
    parser.ts
    sanitizer.ts
  ipc/
    account.ipc.ts
    message.ipc.ts
    sync.ipc.ts
    settings.ipc.ts
```

主进程拥有：

- SQLite 读写。
- 加密凭据保险箱读写：主密码/KDF、数据密钥包装、凭据加解密和导入导出解锁。
- ImapFlow 连接。
- mailparser 解析。
- HTML 净化。
- `shell.openExternal`。

渲染进程不直接访问 Node API。

## 7. Preload API

```ts
window.api.accounts.list()
window.api.accounts.create(input)
window.api.accounts.update(accountId, input)
window.api.accounts.disable(accountId)
window.api.accounts.remove(accountId)

window.api.messages.list({
  accountId?: number
  filters?: Array<'unread' | 'attachments' | 'starred' | 'today'>
  keyword?: string
  cursor?: string
  limit?: number
})
window.api.messages.get(messageId)
window.api.messages.loadBody(messageId)

window.api.sync.startAll()
window.api.sync.startAccount(accountId)
window.api.sync.status()

window.api.settings.get()
window.api.settings.update(input)
```

V1 不暴露 `send`、`reply`、`forward`、`archive`、`delete`、`markRead`。

## 8. 同步策略

初次添加账号：

1. 弹窗提交账号信息。
2. 主进程按 `providerKey` 读取 preset，并解析最终连接参数。
3. 内置 provider 使用固定 IMAP host/port/security，自定义 IMAP 使用用户填写的连接参数。
4. 主进程计算账号别名：用户未填 `accountLabel` 时使用邮箱地址。
5. 主进程验证 IMAP 连接或 OAuth 授权。
6. 主进程验证或创建本地凭据保险箱，把账号凭据加密写入 `onemail_account_credentials`。
7. 账号元数据写入 `onemail_mail_accounts`。
8. 同步文件夹到 `onemail_mail_folders`。
9. 默认只启用收件箱同步。
10. 拉取最近 90 天邮件头到 `onemail_mail_messages`。
11. 写入 `onemail_message_addresses`、`onemail_message_attachments` 元数据和 `onemail_message_search`。
12. 用户点击邮件时再拉取正文到 `onemail_message_bodies`。

增量同步：

- 优先使用 `highest_modseq`。
- 不支持时使用 `last_uid`。
- 每次同步写 `onemail_sync_runs`。
- 同一账号一次只允许一个同步任务。
- 多账号同步默认并发 2。

## 9. 可执行步骤

### Step 1：数据库建表

- 新建 `plan/schema.sql`。
- 应用启动时执行建表语句。
- PRAGMA、索引、种子数据、触发器、视图后续拆成独立迁移。
- 确认 `onemail_schema_migrations` 表存在。

验收：

- `sqlite3 :memory: '.read plan/schema.sql'` 通过。
- 重复执行不会报错。

### Step 2：实现三栏 UI 骨架

- 第一栏：账号列表。
- 第二栏：邮件列表 + 顶部可多选 Tag 筛选。
- 第三栏：邮件正文。
- 新增账号和设置入口打开 ResponsiveDialog。

验收：

- 没有发信入口。
- 没有文件夹树抢占第一栏。
- Tag 可以多选并组合过滤列表。

### Step 3：ResponsiveDialog 和 FilterTag 基础组件

- 安装 `dialog`、`drawer`、`toggle-group`、`badge`、`field`、`input`、`select`、`switch`、`scroll-area`。
- 实现 `components/responsive-dialog.tsx`。
- 实现 `components/mail/mail-filter-tags.tsx`，内部使用 `ToggleGroup type="multiple"`。
- 新增账号、设置、删除确认全部复用它。

验收：

- 桌面宽度打开 Dialog。
- 窄屏打开 Drawer。
- 每个弹窗都有可访问的 Title。

### Step 4：账号接入

- 先做 163 / 自定义 IMAP。
- 再做 Gmail / Outlook OAuth。
- 所有凭据只以加密包写入 `onemail_account_credentials`；应用随机生成本机数据密钥，并通过系统安全存储保护该密钥。
- 内置 provider 的 IMAP 地址、端口和加密方式从 `onemail_provider_presets` 读取，不在新增账号弹窗暴露。
- 163 表单只需要邮箱、授权码/客户端专用密码、可选别名；别名为空时显示邮箱地址。
- 自定义 IMAP 表单额外展示 IMAP 地址、端口和加密方式。

验收：

- 能添加至少一个真实账号。
- 账号出现在第一栏。
- 认证失败有明确错误。
- 新增 163 等内置邮箱时用户不需要填写服务器地址和端口。
- 未填写别名时账号列表显示邮箱地址。

### Step 5：邮件同步和列表

- 同步收件箱邮件头。
- 账号查询驱动第一栏。
- 邮件列表查询驱动第二栏。
- 支持未读、有附件、星标、今日多选筛选；未选中 Tag 表示全部。

验收：

- 多账号邮件可按账号过滤。
- 全部账号聚合可用。
- 重复同步不产生重复邮件。

### Step 6：正文和附件

- 点击邮件按需加载正文。
- HTML 净化后展示。
- 附件展示元数据。

验收：

- 第三栏能展示正文。
- 外部图片默认阻断。
- 附件不默认下载。

### Step 7：设置弹窗

- 账号管理。
- 同步间隔。
- 缓存时间窗口。
- 安全选项。

验收：

- 所有设置通过弹窗完成。
- 关闭弹窗不影响三栏阅读状态。

## 10. V1 完成标准

- 能添加、编辑、禁用、删除邮箱账号。
- 新增内置邮箱时只要求邮箱、密码/授权、可选别名；固定 IMAP 参数由 preset 写死。
- 自定义 IMAP 才展示服务器地址、端口、加密方式。
- 别名未填时默认显示邮箱地址。
- 第一栏只展示账号聚合，不做文件夹树。
- 第二栏支持顶部 Tag 多选筛选。
- 第三栏展示邮件详情和安全正文。
- 数据库建表 SQL 可重复执行。
- 凭据不落 SQLite 明文。
- 没有任何发信相关 UI、API、数据表。

## 11. 任务拆分

### 实施状态

- [x] P0-01 数据库建表：已完成。运行时使用项目内 `src/main/db/schema.sql`，数据库文件位于 Electron `userData/OneMail/onemail.sqlite`；`onemail_schema_migrations` 和 `onemail_crypto_keys` 已纳入运行时 schema。
- [x] P0-02 加密凭据保险箱：已完成。账号密码使用本机随机数据密钥加密，数据密钥由 Electron `safeStorage` 包装后记录在 `onemail_crypto_keys`，数据库不保存明文密码。
- [x] P0-03 Preload API 骨架：已完成。本轮已建立 accounts、messages、sync、settings、system 的安全调用边界，并暴露数据库路径。
- [x] P0-04 三栏 UI 骨架：已完成。本轮已落地账号栏、邮件列表和邮件详情三栏界面，数据从 preload API 读取，不再使用 mock 数组。
- [x] P0-05 ResponsiveDialog 基础组件：已完成。本轮已提供桌面 Dialog / 窄屏 Drawer 的响应式弹窗封装。
- [x] P0-06 FilterTag 多选筛选：已完成。本轮已实现未读、有附件、星标、今日的可组合筛选入口。
- [x] P0-07 账号管理 UI：已完成。本轮已实现新增、编辑、删除确认等账号管理弹窗 UI。
- [x] P0-08 IMAP 账号接入：已完成基础版本。163、QQ、Gmail、Outlook 和自定义 IMAP 使用真实 IMAP 连接测试，新增后同步 INBOX；Gmail/Outlook OAuth 尚未实现。
- [x] P0-09 邮件头同步：已完成基础版本。同步 INBOX 邮件头、flags、收件箱计数和本地搜索索引；暂未实现全文件夹树同步。
- [x] P0-10 邮件正文按需加载：已完成基础版本。点击邮件后通过 IMAP 拉取原文、解析正文和附件元数据，并净化 HTML。
- [x] P0-11 邮件列表查询和详情查询：已完成。支持账号范围、未读、有附件、星标、今日和关键字查询。
- [x] P0-12 设置弹窗：已完成。同步间隔、缓存窗口、外部图片、安全备份导入导出均在设置弹窗内完成。

### P0-01 数据库建表

目标：把 V1 需要的本地数据结构落地。

范围：

- 使用 `plan/schema.sql` 创建所有 `onemail_*` 表。
- 建立数据库连接模块。
- 应用启动时执行建表 SQL。
- 暂不做索引、种子数据、触发器、视图。

产物：

- `src/main/db/connection.ts`
- `src/main/db/schema.ts`
- `src/main/db/repositories/*`

验收：

- 首次启动能创建 SQLite 数据库。
- 重复启动不会报错。
- `onemail_schema_migrations` 表存在。

### P0-02 加密凭据保险箱

目标：账号凭据只以加密包落库。

范围：

- 实现随机本机数据密钥创建、系统安全存储包装和自动解锁流程。
- 创建/读取 `onemail_crypto_keys`。
- 写入/读取 `onemail_account_credentials`。
- 加密 payload 支持 OAuth token、授权码、IMAP 密码。

产物：

- `src/main/crypto/credential-vault.service.ts`
- `src/main/db/repositories/credential.repository.ts`

验收：

- 数据库中看不到明文 token、授权码、密码。
- 系统安全存储不可用或本机密钥无法解锁时不能读取凭据。
- 已解锁后可拿到连接 IMAP 所需凭据。

### P0-03 Preload API 骨架

目标：建立 renderer 和 main 的安全调用边界。

范围：

- 暴露 accounts、messages、sync、settings 四组 API。
- 所有 IPC 入参做基础校验。
- 不暴露发信、回复、删除、归档、标已读接口。

产物：

- `src/preload/index.ts`
- `src/main/ipc/account.ipc.ts`
- `src/main/ipc/message.ipc.ts`
- `src/main/ipc/sync.ipc.ts`
- `src/main/ipc/settings.ipc.ts`

验收：

- renderer 可以调用账号列表、邮件列表、设置读取接口。
- preload 类型声明完整。
- API 中没有 V1 禁止的远程修改能力。

### P0-04 三栏 UI 骨架

目标：先把主界面形态固定下来。

范围：

- 第一栏账号列表。
- 第二栏邮件列表。
- 第三栏邮件详情。
- 第一栏提供新增账号和设置入口。
- 使用 preload API 读取本地 SQLite 数据。

产物：

- `src/renderer/src/components/layout/app-shell.tsx`
- `src/renderer/src/components/account/account-list.tsx`
- `src/renderer/src/components/mail/mail-list.tsx`
- `src/renderer/src/components/mail/mail-reader.tsx`

验收：

- 页面启动后就是三栏邮箱界面。
- 第一栏不展示文件夹树。
- 没有发信入口。
- 窗口缩放时布局不乱。

### P0-05 ResponsiveDialog 基础组件

目标：所有非阅读操作通过弹窗完成。

范围：

- 安装 shadcn `dialog`、`drawer`、`field`、`input`、`select`、`switch`、`scroll-area`。
- 封装 `ResponsiveDialog`。
- 桌面使用 Dialog，窄屏使用 Drawer。

产物：

- `src/renderer/src/components/responsive-dialog.tsx`

验收：

- 每个弹窗都有 Title。
- 桌面宽度打开 Dialog。
- 窄屏打开 Drawer。
- 关闭弹窗不影响三栏选择状态。

### P0-06 FilterTag 多选筛选

目标：邮件列表顶部支持组合筛选。

范围：

- 安装 shadcn `toggle-group`。
- 实现 `未读`、`有附件`、`星标`、`今日` 四个 FilterTag。
- 未选中任何 Tag 时显示全部邮件。
- 支持多选组合，例如 `未读 + 有附件`。

产物：

- `src/renderer/src/components/mail/mail-filter-tags.tsx`

验收：

- FilterTag 不是 Tabs。
- 多选状态可组合。
- 筛选状态会传给 `messages.list({ filters })`。

### P0-07 账号管理 UI

目标：通过弹窗完成账号新增、编辑、删除确认。

范围：

- 新增账号弹窗。
- 新增账号弹窗按 provider 类型渲染字段：内置邮箱隐藏固定 IMAP 参数，自定义 IMAP 才显示地址、端口和加密方式。
- 别名可选，未填写时账号列表显示邮箱地址。
- 编辑账号弹窗。
- 删除账号确认弹窗。
- 账号列表展示状态、未读数、同步状态。

产物：

- `src/renderer/src/components/account/add-account-dialog.tsx`
- `src/renderer/src/components/account/edit-account-dialog.tsx`
- `src/renderer/src/components/account/remove-account-dialog.tsx`

验收：

- 所有账号操作都在弹窗中完成。
- 删除账号需要确认。
- 账号列表能展示全部账号聚合项。

### P0-08 IMAP 账号接入

目标：先跑通 163 / 自定义 IMAP。

范围：

- 使用 ImapFlow 验证 IMAP 连接。
- 163 从 provider preset 读取固定 IMAP host/port/security，用户只输入邮箱、授权码/客户端专用密码、可选别名。
- 自定义 IMAP 才接受用户输入的 host/port/security。
- 创建账号时把空别名补齐为邮箱地址后写入 `account_label`。
- 账号元数据写入 `onemail_mail_accounts`。
- 凭据加密写入 `onemail_account_credentials`。
- 同步远程文件夹到 `onemail_mail_folders`。

产物：

- `src/main/mail/imap-client.ts`
- `src/main/mail/folder-sync.ts`
- `src/main/db/repositories/account.repository.ts`

验收：

- 能添加一个真实 163 或自定义 IMAP 账号。
- 认证失败有明确错误。
- 凭据不以明文落库。
- 内置邮箱新增流程不要求用户填写服务器地址和端口。
- 别名为空时落库和列表展示均为邮箱地址。

### P0-09 邮件头同步

目标：把收件箱邮件列表同步到本地。

范围：

- 默认同步收件箱。
- 拉取最近 90 天邮件头。
- 写入 `onemail_mail_messages`。
- 写入发件人/收件人到 `onemail_message_addresses`。
- 写入附件元数据到 `onemail_message_attachments`。
- 写入 FTS 到 `onemail_message_search`。

产物：

- `src/main/mail/message-sync.ts`
- `src/main/db/repositories/message.repository.ts`
- `src/main/db/repositories/sync.repository.ts`

验收：

- 邮件列表能显示真实邮件。
- 重复同步不产生重复邮件。
- 多账号聚合列表可用。

### P0-10 邮件正文按需加载

目标：点击邮件后再拉取正文。

范围：

- 按 messageId 找到账户、文件夹和 UID。
- 拉取原始邮件内容。
- 使用 mailparser 解析 text/html/附件。
- 净化 HTML 后写入 `onemail_message_bodies`。

产物：

- `src/main/mail/body-loader.ts`
- `src/main/mail/parser.ts`
- `src/main/mail/sanitizer.ts`

验收：

- 点击邮件后第三栏展示正文。
- HTML 只展示净化结果。
- 无 HTML 时展示纯文本。
- 外部图片默认阻断。

### P0-11 邮件列表查询和详情查询

目标：用真实数据替换 mock UI。

范围：

- `messages.list` 支持 accountId、filters、keyword、cursor、limit。
- `messages.get` 返回详情基础数据。
- `messages.loadBody` 拉取正文并返回结果。

产物：

- `src/main/ipc/message.ipc.ts`
- `src/renderer/src/lib/api.ts`
- `src/renderer/src/lib/types.ts`

验收：

- 第一栏点击账号能过滤第二栏。
- FilterTag 多选能过滤列表。
- 点击列表项能更新第三栏。

### P0-12 设置弹窗

目标：配置同步和安全选项。

范围：

- 账号管理设置。
- 同步间隔设置。
- 缓存窗口设置。
- 外部图片阻断设置。
- 加密凭据导入导出入口预留。

产物：

- `src/renderer/src/components/settings/settings-dialog.tsx`
- `src/main/ipc/settings.ipc.ts`

验收：

- 设置只通过弹窗完成。
- 修改设置后可持久化到 `onemail_app_settings`。
- 关闭设置弹窗不影响当前阅读邮件。

### P1-01 Gmail / Outlook OAuth

目标：在 IMAP 跑通后增加 OAuth 账号。

范围：

- Gmail OAuth。
- Outlook OAuth。
- refresh token 加密落库。
- OAuth token 过期刷新。

验收：

- 能添加 Gmail 或 Outlook 账号。
- token 过期后可刷新。
- 失败时账号状态变为 auth_error。

### P1-02 搜索

目标：支持本地缓存搜索。

范围：

- keyword 搜索 FTS。
- 和 accountId、FilterTag 组合。
- 搜索为空时展示空状态。

验收：

- 本地缓存邮件可搜索。
- 多账号搜索可用。
- 搜索不触发远程请求。

### P1-03 同步状态和错误恢复

目标：让同步状态可观察、可重试。

范围：

- 同步任务写入 `onemail_sync_runs`。
- 第一栏展示 active、syncing、auth_error、sync_error、network_error。
- 手动同步全部账号。
- 手动同步单账号。

验收：

- 一个账号失败不影响其他账号。
- 同步失败可重试。
- 错误详情通过弹窗展示。
