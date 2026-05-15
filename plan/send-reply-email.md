# OneMail 邮件操作集成计划

日期：2026-05-15

范围：发邮件、回复、回复全部、转发、邮件列表管理、多选删除、草稿/失败发送记录管理。

## 背景

当前 OneMail 已经完成多账号 IMAP 同步、邮件列表、正文按需加载、附件下载、已读状态同步和 Outlook OAuth 登录。现有 V1 设计曾明确不暴露 `send`、`reply`、`forward`、`archive`、`delete`、`markRead`，现在要把 OneMail 从“阅读器”推进到“可处理邮件”的客户端。

当前关键约束：

- 账号模型只保存 IMAP 参数：`imap_host`、`imap_port`、`imap_security`。
- 凭据已在主进程加密保存，renderer 不接触密码或 OAuth token。
- Outlook OAuth 目前只围绕 IMAP 权限设计，不能直接假定可用于发信。
- 当前同步只优先同步 `inbox` 和 `junk`，Sent、Trash、Drafts 等文件夹角色识别还不完整。
- 本地邮件主表 `onemail_mail_messages` 要求远端 `folder_id + uid`，不适合直接塞入尚未追加到 Sent 的本地已发送邮件或本地草稿。
- 现有 schema 是运行时建表 SQL，不是完整迁移系统；新增列必须考虑已有用户数据库升级。
- 现有 `remote_deleted` 表示远端缺失后的本地隐藏状态，不能直接等同于用户主动删除。

## 目标

P1 目标：

- 支持从账号发送新邮件。
- 支持在邮件详情页回复、回复全部、转发。
- 支持邮件列表管理：多选、范围选择、批量删除、批量本地隐藏。
- 支持删除邮件：移动到废纸篓、从废纸篓永久删除、本地隐藏失败回滚。
- 支持删除草稿、失败发送记录、已发送本地记录。
- 发信和删除都只在主进程执行，renderer 只提交非敏感输入和用户动作。
- 回复邮件正确生成 `Message-ID`、`In-Reply-To`、`References`，并在成功后尽量把原邮件标记为 `\Answered`。
- 转发邮件正确生成 `Fwd:` 主题、引用原始邮件头和正文，附件策略明确可控。
- 成功发出后保留本地发送记录，并尽量追加到远端 Sent 文件夹。
- SMTP、IMAP 删除或服务商操作失败时，保留可恢复状态，给用户明确错误。

暂不放进第一版的内容：

- 完整草稿箱双向同步。
- 邮件模板、签名、多身份别名。
- 复杂富文本编辑器。
- 离线自动重试队列。
- 批量归档、跨文件夹移动规则、跨账号批量恢复。
- 远端会话冲突的完整合并 UI。

## 产品语义

### 写信

- 入口：顶部写信按钮。
- 默认发件账号：
  - 当前选中具体账号时使用该账号。
  - 当前为“全部账号”时使用最近使用账号或第一个可发送账号。
- 第一版正文使用纯文本 `Textarea`，允许后续演进到富文本。
- 附件从本地文件选择，renderer 只传路径，主进程校验文件存在、大小和总量。

### 回复

- `回复`：收件人优先使用原邮件 `reply_to`，否则使用 `from`。
- `回复全部`：包含原发件人、原收件人、原抄送，排除当前账号邮箱和重复地址。
- 主题没有 `Re:` 时补 `Re: `，已有则保留。
- 设置 `In-Reply-To` 和 `References`。
- 回复成功后：
  - 本地 `is_answered = 1`。
  - 远端尽量设置 `\Answered`。
  - 设置失败不回滚 SMTP 发送，但记录 warning。

### 转发

- 入口：邮件详情页增加转发按钮。
- `转发` 不设置 `In-Reply-To` / `References`，避免污染原始会话线程。
- 主题没有 `Fwd:` 或 `Fw:` 时补 `Fwd: `，已有则保留。
- 正文第一版采用纯文本引用：
  - 用户新正文在前。
  - 下方附带 `---------- Forwarded message ----------`。
  - 包含原发件人、日期、主题、收件人、抄送。
  - 原 HTML 正文不直接进入编辑器，避免外部资源和样式污染。
- 附件策略：
  - 默认不自动带原附件，避免误发大文件或敏感附件。
  - composer 展示“包含原附件”开关。
  - 用户开启后，主进程从原邮件 IMAP 拉取附件内容，再作为新邮件附件发送。
  - 转发内联图片第一版按普通附件处理，不尝试保留 HTML cid 引用。

### 删除邮件

删除必须区分几个动作：

- `移动到废纸篓`：普通删除。优先把远端邮件 `UID MOVE` 到 Trash；不支持 `MOVE` 时使用 `UID COPY` 到 Trash，再给原邮件打 `\Deleted` 并 `EXPUNGE` 或延后 expunge。
- `从废纸篓永久删除`：当前邮件位于 Trash 时，给该邮件打 `\Deleted` 并 `EXPUNGE`。
- `仅从本地隐藏`：远端操作失败、账号离线或用户选择本地清理时，只把本地记录标记为用户隐藏，不删除远端。
- `恢复`：在 Trash 中把邮件移动回 INBOX；若只是本地隐藏，则清除本地隐藏标记。

第一版建议：

1. 非 Trash 邮件点击删除等于“移动到废纸篓”。
2. Trash 邮件点击删除需要二次确认，等于“永久删除”。
3. 远端删除失败时不改成本地成功，除非用户明确选择“仅本地隐藏”。
4. 删除成功后立即从当前列表移除，并刷新账号统计。

### 邮件列表管理

现有 `MailList` 是单选阅读模型：`selectedMessageId` 决定右侧阅读器展示哪封邮件。多选删除需要新增“操作选择状态”，不能复用 `selectedMessageId`，否则会让阅读器选择和批量选择互相干扰。

列表管理第一版目标：

- 支持勾选单封邮件。
- 支持 Shift 范围选择。
- 支持当前已加载邮件全选。
- 支持清空选择。
- 支持批量移到废纸篓。
- 支持删除失败后的部分成功提示。
- 筛选、搜索、切换账号后自动清空选择。
- 加载更多后保留已选邮件，但不自动选中新加载邮件。

交互建议：

- 每行左侧增加 checkbox，未进入多选时仍保持紧凑。
- 用户勾选任意邮件后，列表顶部筛选栏切换为批量操作栏。
- 批量操作栏展示：
  - 已选数量。
  - 全选当前已加载。
  - 清空选择。
  - 移到废纸篓。
  - 永久删除：仅 Trash 视图或明确筛选 Trash 时出现。
- 点击邮件正文区域仍打开阅读器；点击 checkbox 只改变多选状态。
- `Delete` / `Backspace` 快捷键仅在多选状态且焦点位于列表区域时触发，并需要确认。
- 如果当前正在阅读的邮件被批量删除，阅读器自动选择下一封未删除邮件。

批量删除语义：

- 一批邮件可能来自多个账号或多个文件夹；主进程必须按 `accountId + folderId` 分组执行 IMAP 操作。
- 批量删除允许部分成功。
- 返回结果要包含 `succeededMessageIds`、`failedItems`、`deletedCount`、`failedCount`。
- renderer 先根据成功列表从当前邮件数组移除，失败项保留并展示错误摘要。
- 如果失败数量较多，只展示前 3 条错误，其余汇总。

### 删除发送记录与草稿

outbox/sent 本地记录需要独立删除语义：

- `draft`：删除本地草稿及附件引用，不影响远端，因为第一版不做远端 Drafts 同步。
- `failed`：删除本地失败记录，不影响远端，因为没有成功发送。
- `sent`：删除本地发送记录；如果已追加到远端 Sent，可提供“同时删除远端 Sent 副本”二阶段能力。
- `sending`：不能直接删除，只能取消发送；第一版可以禁用删除。

## 推荐拆分

第一版先做“可用、可验证”的窄闭环：

1. 密码/授权码账号通过 SMTP 发纯文本或简单 HTML 邮件。
2. 阅读器支持回复、回复全部、转发。
3. 邮件列表支持多选和批量移到 Trash。
4. 支持删除收件箱/垃圾邮件中的邮件到 Trash。
5. 发出后写本地 outbox/sent 记录，远端 Sent 追加失败不影响“已发送”结果，但要提示。
6. Outlook OAuth 发信作为第二阶段处理，因为它需要重新确认 OAuth scope 和发送通道。

这样可以先覆盖 Gmail 应用密码、163、QQ、自定义 SMTP，再处理 Microsoft Graph 或 SMTP XOAUTH2 的差异。

## 数据模型

### Provider preset 扩展

在 `onemail_provider_presets` 增加 SMTP 配置：

- `smtp_host TEXT`
- `smtp_port INTEGER`
- `smtp_security TEXT CHECK (smtp_security IN ('ssl_tls', 'starttls', 'none'))`
- `smtp_auth_type TEXT CHECK (smtp_auth_type IN ('oauth2', 'app_password', 'password', 'bridge', 'manual'))`
- `smtp_requires_auth INTEGER NOT NULL DEFAULT 1`

内置 provider 建议预置：

- Gmail：应用密码账号走 SMTP。
- 163：授权码账号走 SMTP。
- QQ：授权码账号走 SMTP。
- Outlook：先标记为 OAuth send，需要第二阶段确认通道。
- 自定义：用户手动填写 SMTP。

### Account 扩展

在 `onemail_mail_accounts` 增加账号级 SMTP 字段，便于自定义账号覆盖 preset：

- `smtp_host TEXT`
- `smtp_port INTEGER`
- `smtp_security TEXT`
- `smtp_auth_type TEXT`
- `smtp_enabled INTEGER NOT NULL DEFAULT 1`

内置账号创建时从 preset 写入；自定义账号表单需要新增 SMTP 服务器、端口、安全模式。为了降低表单负担，可以默认“SMTP 设置同邮箱类型自动填充”，自定义账号才展开高级 SMTP 字段。

### 文件夹角色扩展

当前 `onemail_mail_folders.role` 已包含 `sent`、`drafts`、`trash`，但同步识别主要覆盖 `inbox` 和 `junk`。需要补齐特殊文件夹识别：

- `\Sent`、`Sent Messages`、`Sent Mail`、`已发送`、`已发送邮件`
- `\Drafts`、`Drafts`、`草稿箱`
- `\Trash`、`Deleted Messages`、`Deleted Items`、`废纸篓`、`已删除`
- `\Archive`、`All Mail` 后续可用

新增 helper：

- `findFolderByRole(accountId, 'trash')`
- `findFolderByRole(accountId, 'sent')`
- `ensureSpecialFolders(accountId)`：登录后 LIST 并保存所有特殊文件夹元数据。

### Message 删除状态扩展

在 `onemail_mail_messages` 增加本地用户动作字段：

- `user_deleted INTEGER NOT NULL DEFAULT 0`
- `user_hidden INTEGER NOT NULL DEFAULT 0`
- `deleted_at TEXT`
- `delete_error TEXT`
- `last_operation_at TEXT`

字段语义：

- `remote_deleted`：远端同步发现 UID 不存在。
- `is_deleted`：远端 flag 中有 `\Deleted`。
- `user_deleted`：用户主动发起删除动作，并且远端操作已成功或正在等待同步确认。
- `user_hidden`：只从本地列表隐藏，不代表远端删除。

消息列表默认过滤：

- `remote_deleted = 0`
- `user_hidden = 0`
- 非 Trash 视图中过滤 `user_deleted = 0`

后续如果做 Trash 视图，可显示 role 为 `trash` 的文件夹邮件。

### Outbox / Sent 本地记录

新增 `onemail_outbox_messages`，不要直接写入 `onemail_mail_messages`：

- `outbox_id INTEGER PRIMARY KEY AUTOINCREMENT`
- `account_id INTEGER NOT NULL`
- `related_message_id INTEGER`
- `compose_kind TEXT CHECK (compose_kind IN ('new', 'reply', 'reply_all', 'forward'))`
- `status TEXT CHECK (status IN ('draft', 'queued', 'sending', 'sent', 'failed', 'cancelled', 'deleted'))`
- `rfc822_message_id TEXT NOT NULL`
- `in_reply_to TEXT`
- `references_header TEXT`
- `from_name TEXT`
- `from_email TEXT NOT NULL`
- `to_json TEXT NOT NULL DEFAULT '[]'`
- `cc_json TEXT NOT NULL DEFAULT '[]'`
- `bcc_json TEXT NOT NULL DEFAULT '[]'`
- `subject TEXT`
- `body_text TEXT`
- `body_html TEXT`
- `raw_mime TEXT`
- `remote_sent_folder_id INTEGER`
- `remote_sent_uid INTEGER`
- `sent_at TEXT`
- `deleted_at TEXT`
- `last_error TEXT`
- `last_warning TEXT`
- `created_at TEXT`
- `updated_at TEXT`

新增 `onemail_outbox_attachments`：

- `attachment_id INTEGER PRIMARY KEY AUTOINCREMENT`
- `outbox_id INTEGER NOT NULL`
- `source_kind TEXT CHECK (source_kind IN ('local_file', 'forwarded_attachment'))`
- `source_message_id INTEGER`
- `source_attachment_id INTEGER`
- `file_path TEXT`
- `filename TEXT NOT NULL`
- `mime_type TEXT`
- `size_bytes INTEGER NOT NULL DEFAULT 0`
- `content_id TEXT`
- `created_at TEXT`

### 操作日志

新增 `onemail_message_operations`，方便失败恢复和调试：

- `operation_id INTEGER PRIMARY KEY AUTOINCREMENT`
- `operation_batch_id TEXT`
- `message_id INTEGER`
- `outbox_id INTEGER`
- `account_id INTEGER NOT NULL`
- `operation_kind TEXT CHECK (operation_kind IN ('send', 'reply', 'reply_all', 'forward', 'delete', 'restore', 'permanent_delete', 'append_sent', 'mark_answered'))`
- `status TEXT CHECK (status IN ('pending', 'running', 'success', 'failed', 'cancelled'))`
- `remote_action TEXT`
- `error_message TEXT`
- `created_at TEXT`
- `updated_at TEXT`

第一版可以只写日志，不做复杂重放。

### 迁移方式

因为 `CREATE TABLE IF NOT EXISTS` 不会给已有表补列，需要新增一个 idempotent schema upgrade：

- `src/main/db/schema-upgrade.ts`
- 使用 `PRAGMA table_info(table_name)` 判断列是否存在。
- 缺列时执行 `ALTER TABLE ... ADD COLUMN ...`。
- 新表继续放在 `schema.sql`。
- 在 `initializeDatabase()` 中 `applySchema()` 后运行 upgrade。

## 主进程设计

### 新增模块

建议新增：

- `src/main/mail/smtp-send.ts`：创建 SMTP transport、发送 MIME。
- `src/main/mail/message-composer.ts`：构建 MIME、生成 Message-ID、处理附件。
- `src/main/mail/reply-draft.ts`：根据原邮件生成回复草稿。
- `src/main/mail/forward-draft.ts`：根据原邮件生成转发草稿和附件候选。
- `src/main/mail/sent-folder-append.ts`：发送成功后尝试通过 IMAP `APPEND` 到 Sent。
- `src/main/mail/message-delete.ts`：移动 Trash、永久删除、恢复、本地隐藏。
- `src/main/mail/special-folders.ts`：识别 Sent、Trash、Drafts 等特殊文件夹。
- `src/main/db/repositories/outbox.repository.ts`：保存草稿、发送中、成功、失败、删除状态。
- `src/main/db/repositories/message-operation.repository.ts`：记录发送/删除/追加/标记失败。
- `src/main/ipc/compose.ts`：注册 composer IPC。
- `src/main/ipc/message-actions.ts`：注册删除、恢复、永久删除等 IPC。

建议使用 `nodemailer` 处理 SMTP、MIME、附件和测试 transport。当前项目手写了 IMAP，但 SMTP 和 MIME 组合比 IMAP 标志同步更容易踩兼容性坑，用成熟库更稳。

### 发信流程

1. renderer 调用 `compose/send`。
2. 主进程验证 `accountId`、收件人、主题、正文、附件路径和大小。
3. 读取账号 SMTP 配置。
4. 读取加密凭据或 OAuth send token。
5. 创建 `outbox` 记录，状态 `sending`。
6. 构建 MIME：
   - `From`
   - `To` / `Cc` / `Bcc`
   - `Subject`
   - `Date`
   - `Message-ID`
   - 回复时加 `In-Reply-To`、`References`
7. 调用 SMTP 或 provider send transport。
8. 成功后更新 `outbox.status = sent`、`sent_at`。
9. 尝试追加到 Sent 文件夹。
10. 回复成功后尝试把原邮件设置 `\Answered`。
11. 广播 `compose/sent`，让 renderer 刷新状态。

### 回复草稿流程

新增主进程方法 `compose/createReplyDraft(messageId, replyMode)`：

- 查询原邮件基础信息、`rfc822_message_id`、`references_header`、`from`、`reply_to`、`to`、`cc`。
- `reply`：收件人优先使用 `reply_to`，否则使用 `from`。
- `reply_all`：包含原发件人、原收件人、原抄送，但排除当前账号邮箱和重复地址。
- subject 规则：没有 `Re:` 时加 `Re: `，已有则保留。
- `In-Reply-To = 原 rfc822_message_id`。
- `References = 原 references_header + 原 rfc822_message_id`，去重并控制长度。
- 正文第一版用纯文本引用，避免把外部 HTML 直接带进编辑器。

为此需要扩展 `message.repository.ts`，让详情接口能返回 `to`、`cc`、`bcc`、`reply_to` 地址列表，而不仅是 `from`。

### 转发草稿流程

新增主进程方法 `compose/createForwardDraft(messageId)`：

- 查询原邮件详情和正文；正文未加载时先按需加载。
- 生成主题：`Fwd: ${subject}`。
- 生成转发引用头：
  - From
  - Date
  - Subject
  - To
  - Cc
- 生成正文：用户输入区为空，引用内容放在正文下半部分。
- 返回可选附件候选列表：
  - `attachmentId`
  - `filename`
  - `mimeType`
  - `sizeBytes`
  - 默认 `selected = false`
- 用户勾选原附件后，发送时主进程通过 IMAP 重新拉取原始附件内容。

### 删除流程

新增主进程方法 `messages/delete`：

1. 根据 `messageId` 查询账号、folder path、UID、folder role。
2. 如果当前 folder role 不是 `trash`：
   - 查找 Trash 文件夹。
   - 优先执行 `UID MOVE uid "TrashPath"`。
   - 如果服务器不支持 MOVE，则执行 `UID COPY uid "TrashPath"`，再 `UID STORE uid +FLAGS.SILENT (\Deleted)`，最后根据策略 `EXPUNGE`。
   - 本地把原邮件 `user_deleted = 1` 或 `remote_deleted = 1`，从当前列表移除。
   - 可选触发 Trash 文件夹轻量同步，拿到新 UID。
3. 如果当前 folder role 是 `trash`：
   - 二次确认后执行 `UID STORE uid +FLAGS.SILENT (\Deleted)`。
   - 执行 `EXPUNGE`。
   - 本地 `remote_deleted = 1`，从列表移除。
4. 失败时：
   - 不隐藏邮件。
   - 写 `delete_error` 和 `onemail_message_operations`。
   - renderer 展示错误，并允许“仅本地隐藏”。

新增主进程方法 `messages/hideLocal`：

- 只设置 `user_hidden = 1`。
- 用于用户明确清理本地视图，不声明远端删除成功。

新增主进程方法 `messages/restore`：

- Trash 中的邮件移动回 INBOX。
- 本地隐藏邮件清除 `user_hidden`。

新增主进程方法 `messages/bulkDelete`：

1. 接收 `messageIds`、`mode`、`allowLocalHide`。
2. 去重并限制批量大小，建议第一版上限 200 封。
3. 查询每封邮件的账号、folder path、folder role、UID。
4. 按 `accountId + folderId + mode` 分组。
5. 每组复用同一个 IMAP session 执行删除，减少重复登录。
6. 每封邮件写一条 `onemail_message_operations`，共享同一个 `operation_batch_id`。
7. 单封失败不阻断整批，除非账号登录失败导致整组失败。
8. 返回成功和失败明细。
9. 成功项从本地列表移除，失败项保留并写入 `delete_error`。

### IMAP Session 扩展

`SimpleImapSession` 需要新增命令：

- `capability()`：检测 `MOVE`。
- `moveMessage(uid, targetMailbox)`：`UID MOVE`。
- `copyMessage(uid, targetMailbox)`：`UID COPY`。
- `setDeletedFlag(uid)`：设置 `\Deleted`。
- `setAnsweredFlag(uid)`：设置 `\Answered`。
- `expunge()`：永久删除已标记邮件。
- `appendMessage(mailbox, rawMime, flags)`：追加到 Sent。

命令失败必须清理错误文本，不把服务端返回的大段 HTML 直接展示给用户。

## IPC 与类型

在 `src/shared/types.ts` 增加：

- `MailAddressInput`
- `MailComposeMode = 'new' | 'reply' | 'reply_all' | 'forward'`
- `MailSendInput`
- `MailSendResult`
- `ReplyDraftInput`
- `ForwardDraftInput`
- `ComposeDraft`
- `ForwardAttachmentCandidate`
- `OutboxMessage`
- `MessageDeleteMode = 'trash' | 'permanent' | 'local_hide'`
- `MessageDeleteInput`
- `MessageDeleteResult`
- `MessageBulkDeleteInput`
- `MessageBulkDeleteResult`
- `MessageBulkDeleteFailure`
- `MessageRestoreResult`

新增 preload namespace：

```ts
compose: {
  createReplyDraft: (input: ReplyDraftInput) => Promise<ComposeDraft>
  createForwardDraft: (input: ForwardDraftInput) => Promise<ComposeDraft>
  send: (input: MailSendInput) => Promise<MailSendResult>
  saveDraft: (input: MailSendInput) => Promise<OutboxMessage>
  deleteDraft: (outboxId: number) => Promise<boolean>
  retry: (outboxId: number) => Promise<MailSendResult>
  deleteOutbox: (outboxId: number) => Promise<boolean>
  onSent: (callback: (result: MailSendResult) => void) => () => void
}

messages: {
  delete: (input: MessageDeleteInput) => Promise<MessageDeleteResult>
  bulkDelete: (input: MessageBulkDeleteInput) => Promise<MessageBulkDeleteResult>
  restore: (messageId: number) => Promise<MessageRestoreResult>
  hideLocal: (messageId: number) => Promise<MessageDeleteResult>
}
```

第一版可以先实现 `createReplyDraft`、`createForwardDraft`、`send`、`messages/delete`、`messages/bulkDelete`、`messages/hideLocal`，`saveDraft` / `retry` 跟 outbox UI 一起做。

## Renderer 设计

### 入口

- `TitleBar` 增加“写邮件”图标按钮。
- `MailReader` 主题栏右侧增加回复、回复全部、转发、删除图标按钮。
- 邮件列表项增加 checkbox，多选后显示批量操作栏。
- 账号列表选中具体账号时，写邮件默认使用该账号；选中“全部账号”时默认使用第一可用账号。
- 回复和转发固定使用原邮件所属账号。

### 新增组件

建议新增：

- `src/renderer/src/components/mail/mail-composer.tsx`
- `src/renderer/src/components/mail/address-input.tsx`
- `src/renderer/src/components/mail/mail-list-selection-toolbar.tsx`
- `src/renderer/src/components/mail/delete-message-dialog.tsx`
- `src/renderer/src/features/mailbox/use-mail-composer.ts`
- `src/renderer/src/features/mailbox/use-message-selection.ts`
- `src/renderer/src/features/mailbox/use-message-actions.ts`

composer 形态：

- 使用现有 `Dialog` 或 `Sheet`。
- 字段：发件账号、收件人、抄送、密送、主题、正文、附件。
- 正文第一版用 `Textarea`，后续再引入富文本。
- 转发时显示原附件候选，用户可勾选。
- 附件用 Electron file dialog 选择，renderer 只拿文件路径并交给主进程校验。
- 发送中禁用按钮，失败保留编辑内容并展示错误。

删除交互：

- 单封删除可以从阅读器按钮触发。
- 批量删除从列表批量操作栏触发。
- 非 Trash 邮件：按钮文案“移到废纸篓”，可直接执行或轻量确认。
- Trash 邮件：按钮文案“永久删除”，必须二次确认。
- 删除失败：展示“远端删除失败”，提供“仅从本地隐藏”次级操作。
- 删除成功：列表选择下一封邮件；没有下一封时显示空状态。
- 批量删除部分失败：成功项从列表消失，失败项保持勾选或高亮，并显示错误摘要。

### 状态刷新

- 发送成功后关闭 composer 或显示成功状态。
- 回复发送成功后更新当前邮件的 `is_answered`。
- 转发发送成功后可只记录 outbox，不改变原邮件状态。
- 删除成功后从当前列表移除并更新未读/总数。
- 批量删除成功后清除成功项选择状态，失败项保留选择状态。
- 如果 Sent 追加成功或后续同步拉到 Sent 邮件，邮件列表自然显示；否则发送记录先留在 outbox 历史。

## 安全与校验

必须在主进程做校验：

- 邮箱地址解析和校验。
- 禁止 header 字段包含 CR/LF，防止 header injection。
- 附件路径必须是用户显式选择的本地文件。
- 限制单封邮件总附件大小，建议默认 25 MB。
- 转发原附件也要计入大小限制。
- 不允许 renderer 传入 SMTP 密码或 OAuth token。
- 回复/转发引用默认纯文本；如果以后支持 HTML 引用，必须转义原文。
- 同一账号同时只允许一个发送任务，避免重复点击造成重复邮件。
- 删除、永久删除必须有操作锁，避免同一 UID 重复执行。
- 永久删除需要二次确认，且不可恢复。

## OAuth / Outlook 方案

Outlook 发信不要直接混进第一阶段。当前 OAuth 代码只为 IMAP 验证 token audience 和 scope，发信需要单独设计：

- 方案 A：Microsoft Graph `sendMail`，新增 Graph `Mail.Send` 授权和单独 token 处理。
- 方案 B：SMTP XOAUTH2，新增 SMTP send scope，并处理租户禁用 SMTP AUTH 的情况。

推荐先调研并验证官方文档后选择。实现上应把 `send transport` 抽象成：

- `smtp-password`
- `smtp-oauth2`
- `microsoft-graph`

这样 Gmail/163/QQ/自定义 SMTP 和 Outlook OAuth 不会互相污染。

## 文件改动清单

主进程：

- `src/main/db/schema.sql`
- `src/main/db/schema-upgrade.ts`
- `src/main/db/connection.ts`
- `src/main/db/repositories/account.repository.ts`
- `src/main/db/repositories/message.repository.ts`
- `src/main/db/repositories/outbox.repository.ts`
- `src/main/db/repositories/message-operation.repository.ts`
- `src/main/mail/imap-session.ts`
- `src/main/mail/smtp-send.ts`
- `src/main/mail/message-composer.ts`
- `src/main/mail/reply-draft.ts`
- `src/main/mail/forward-draft.ts`
- `src/main/mail/sent-folder-append.ts`
- `src/main/mail/message-delete.ts`
- `src/main/mail/special-folders.ts`
- `src/main/ipc/compose.ts`
- `src/main/ipc/message-actions.ts`
- `src/main/ipc/index.ts`

共享与 preload：

- `src/shared/types.ts`
- `src/preload/index.ts`
- `src/preload/index.d.ts`

renderer：

- `src/renderer/src/lib/api.ts`
- `src/renderer/src/features/mailbox/mailbox-workspace.tsx`
- `src/renderer/src/features/mailbox/use-mail-composer.ts`
- `src/renderer/src/features/mailbox/use-message-selection.ts`
- `src/renderer/src/features/mailbox/use-message-actions.ts`
- `src/renderer/src/components/layout/app-shell.tsx` 或当前 `TitleBar`
- `src/renderer/src/components/mail/mail-list.tsx`
- `src/renderer/src/components/mail/mail-list-selection-toolbar.tsx`
- `src/renderer/src/components/mail/mail-reader.tsx`
- `src/renderer/src/components/mail/mail-composer.tsx`
- `src/renderer/src/components/mail/address-input.tsx`
- `src/renderer/src/components/mail/delete-message-dialog.tsx`
- `src/renderer/src/components/account/account-form-types.ts`
- 自定义账号表单相关组件

依赖：

- `nodemailer`
- `@types/nodemailer`，如当前版本仍需要类型包

## 实施任务拆分

### T0 任务边界确认

- T0-01 确认第一版支持的账号范围：Gmail 应用密码、163、QQ、自定义 SMTP；Outlook 发信放 P1-10。
- T0-02 确认删除第一版只做“移到 Trash”和“Trash 永久删除”，不做归档、不做批量恢复。
- T0-03 确认邮件列表第一版只对当前已加载邮件全选，不做“全选搜索结果中的全部 N 封”。

### T1 Schema 与迁移

- T1-01 新增 `schema-upgrade.ts`，支持已有库补列。
- T1-02 扩展 provider/account SMTP 字段。
- T1-03 扩展 message 删除状态字段。
- T1-04 新增 outbox 表、outbox 附件表。
- T1-05 新增 message operation 表和 `operation_batch_id`。
- T1-06 为 message 列表查询补充默认过滤：`remote_deleted = 0`、`user_hidden = 0`、必要时过滤 `user_deleted`。

### T2 类型与 IPC 边界

- T2-01 在 `src/shared/types.ts` 增加 compose、delete、bulk delete 类型。
- T2-02 在 preload 增加 `compose` API。
- T2-03 在 preload 增加 `messages.delete`、`messages.bulkDelete`、`messages.hideLocal`、`messages.restore`。
- T2-04 在 `src/main/ipc/index.ts` 注册 compose 和 message actions。
- T2-05 在 `src/renderer/src/lib/api.ts` 增加对应封装。

### T3 特殊文件夹与 IMAP 命令

- T3-01 抽出 `special-folders.ts`，识别 Inbox、Junk、Sent、Drafts、Trash。
- T3-02 扩展 `SimpleImapSession`：`CAPABILITY`、`UID MOVE`、`UID COPY`、`\Deleted`、`\Answered`、`EXPUNGE`、`APPEND`。
- T3-03 给删除 fallback 做兼容策略：MOVE 优先，COPY + Deleted + EXPUNGE 兜底。
- T3-04 增加 IMAP 错误清洗，避免把服务端 HTML 原样展示。

### T4 单封删除

- T4-01 新增 `message-delete.ts`，实现单封移到 Trash。
- T4-02 实现 Trash 中永久删除。
- T4-03 实现本地隐藏 `hideLocal`。
- T4-04 删除成功后更新本地 message 状态和文件夹统计。
- T4-05 删除失败时写 `delete_error` 和 operation 日志。

### T5 批量删除

- T5-01 实现 `messages/bulkDelete` IPC。
- T5-02 批量请求去重、上限校验、按账号和文件夹分组。
- T5-03 每组复用 IMAP session，逐封执行，支持部分成功。
- T5-04 返回 `succeededMessageIds`、`failedItems`、`deletedCount`、`failedCount`。
- T5-05 renderer 根据成功项移除列表消息，根据失败项保留选择并展示摘要。
- T5-06 批量删除后更新账号未读数和总数。

### T6 邮件列表选择 UI

- T6-01 新增 `use-message-selection.ts`，维护 `selectedMessageIds`、last selected id、range selection。
- T6-02 `MailList` 行左侧增加 checkbox，点击 checkbox 不触发阅读选择。
- T6-03 支持 Shift 范围选择当前已加载邮件。
- T6-04 新增 `MailListSelectionToolbar`：已选数量、全选已加载、清空、移到废纸篓。
- T6-05 搜索、筛选、切换账号、刷新列表时清空或裁剪选择状态。
- T6-06 删除当前阅读邮件后自动选择下一封可见邮件。
- T6-07 加载更多后保留已选项，但不自动选中新加载项。

### T7 Composer 基础

- T7-01 新增 outbox repository。
- T7-02 新增 `message-composer.ts`，生成 MIME、Message-ID、附件。
- T7-03 新增 `smtp-send.ts`，密码/授权码账号可发送。
- T7-04 发送成功后写 outbox `sent`；失败写 `failed`。
- T7-05 发送成功后尝试追加到 Sent，失败只写 warning。

### T8 回复与转发

- T8-01 扩展 message detail 地址数据：to、cc、bcc、reply_to、references。
- T8-02 新增 `reply-draft.ts`，实现回复/回复全部草稿。
- T8-03 新增 `forward-draft.ts`，实现转发草稿和原附件候选。
- T8-04 composer 支持 reply/reply_all/forward 三种模式。
- T8-05 回复成功后设置本地和远端 `\Answered`。

### T9 草稿与发送记录管理

- T9-01 支持保存本地草稿。
- T9-02 支持删除本地草稿。
- T9-03 支持删除失败发送记录。
- T9-04 支持失败发送记录重试。
- T9-05 禁止直接删除 `sending` 状态记录。

### T10 验证

- T10-01 typecheck。
- T10-02 单测：reply draft、forward draft、bulk delete 分组、header injection。
- T10-03 集成验证：163/QQ/Gmail 应用密码发信、回复、转发。
- T10-04 集成验证：单封删除、批量删除、部分失败显示。
- T10-05 UI 验证：多选、Shift 选择、删除后阅读器选择、搜索筛选后选择状态。

## 验收计划

### P1-01 Schema 与类型

- 新增 SMTP 字段、outbox 表、操作日志表、删除状态字段和迁移。
- 现有数据库启动后能自动补列。
- `npm run typecheck` 通过。

### P1-02 特殊文件夹与 SMTP 配置

- 能识别 Sent、Trash、Drafts、Junk、Inbox。
- 内置账号创建时落库 SMTP 配置。
- 自定义账号可以填写 SMTP。
- 已有账号没有 SMTP 字段时，能从 provider preset 或域名默认值补齐。

### P1-03 新邮件发送

- 使用 163/QQ/Gmail 应用密码发送纯文本邮件成功。
- 失败时本地 outbox 记录为 `failed`，错误可读。
- renderer 不接触密码。

### P1-04 回复与回复全部

- 回复草稿收件人、抄送、主题正确。
- `In-Reply-To`、`References` 正确写入。
- 发送成功后原邮件本地 `is_answered = 1`，远端尽量同步 `\Answered`。

### P1-05 转发

- 转发草稿主题、引用头、正文正确。
- 默认不带原附件。
- 勾选原附件后，主进程从 IMAP 拉取附件并发送。
- 超出大小限制时拒绝发送并保留草稿。

### P1-06 删除邮件

- 非 Trash 邮件可移动到 Trash。
- Trash 邮件可永久删除，且必须确认。
- 远端删除失败时邮件仍保留在列表，并显示错误。
- 用户选择“仅本地隐藏”后邮件从本地列表消失但不声明远端删除成功。
- 同步后远端已删除邮件继续按 `remote_deleted` 隐藏。

### P1-07 邮件列表多选管理

- 单封 checkbox 选择不影响右侧阅读器。
- Shift 可以选择当前已加载范围。
- 全选只作用于当前已加载邮件。
- 批量删除支持部分成功，失败项保留在列表。
- 搜索、筛选、切换账号后选择状态正确清理。
- 删除当前阅读邮件后自动选择下一封可见邮件。

### P1-08 附件与 Sent 追加

- 支持添加本地附件。
- 超出大小限制时主进程拒绝。
- 发送成功后尽量 `APPEND` 到 Sent 文件夹。
- Sent 追加失败不回滚 SMTP 发送，但 outbox 记录 warning。

### P1-09 草稿与发送记录管理

- 可保存本地草稿。
- 可删除草稿。
- 可删除失败发送记录。
- 发送中记录不可直接删除。

### P1-10 Outlook OAuth 发信

- 选定 Microsoft Graph 或 SMTP XOAUTH2。
- 新增授权 scope 和 token 存储策略。
- 重新授权后可从 Outlook 账号发送。
- 权限缺失时提示用户重新授权。

## 测试重点

- `reply-draft`：reply-to 优先级、reply-all 去重、排除本人地址、subject `Re:` 规则。
- `forward-draft`：`Fwd:` 规则、原始头引用、默认不带附件、勾选附件后的拉取。
- `message-composer`：header injection 防护、Message-ID 生成、References 长度控制。
- `smtp-send`：成功、认证失败、网络失败、附件不存在、附件超限。
- `message-delete`：MOVE 支持、COPY + Deleted fallback、Trash 永久删除、失败回滚、本地隐藏。
- `special-folders`：Gmail、Outlook、163、QQ、自定义邮箱的 Sent/Trash 识别。
- `schema-upgrade`：空库、旧库、重复启动都不报错。
- renderer：发送中状态、失败保留草稿、转发附件勾选、删除确认、删除后选择下一封。

## 最小可交付定义

最小可交付版本不要求 Outlook OAuth 发信、不要求远端草稿同步、不要求富文本。只要满足以下条件即可合入：

- 163/QQ/Gmail 应用密码账号可以发送新邮件。
- 同一账号收到的邮件可以回复、回复全部、转发。
- 收件人、主题、正文、回复线程头、转发引用头正确。
- 非 Trash 邮件可以移动到 Trash。
- Trash 邮件可以永久删除并有确认。
- 失败邮件可在本地保留并重试或删除记录。
- 所有敏感凭据只在主进程读取。
