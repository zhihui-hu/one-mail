import * as React from 'react'
import { Paperclip, Save, Send, X } from 'lucide-react'

import { AddressInput } from '@renderer/components/mail/address-input'
import type { Account } from '@renderer/components/mail/types'
import { Button } from '@renderer/components/ui/button'
import { Field, FieldError, FieldGroup, FieldLabel } from '@renderer/components/ui/field'
import { Input } from '@renderer/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@renderer/components/ui/native-select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle
} from '@renderer/components/ui/sheet'
import { Textarea } from '@renderer/components/ui/textarea'
import { selectMailAttachments, type ComposeDraft, type SendMessageInput } from '@renderer/lib/api'
import type { MailAttachmentInput } from '../../../../shared/types'

type MailComposerProps = {
  open: boolean
  accounts: Account[]
  draft: ComposeDraft | null
  pending?: boolean
  onOpenChange: (open: boolean) => void
  onSend: (input: SendMessageInput) => Promise<void>
  onSaveDraft: (input: SendMessageInput) => Promise<void>
}

type ComposerFormState = {
  draftKey: string
  accountId: string
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  bodyText: string
  attachments: MailAttachmentInput[]
  error: string | null
}

export function MailComposer({
  open,
  accounts,
  draft,
  pending = false,
  onOpenChange,
  onSend,
  onSaveDraft
}: MailComposerProps): React.JSX.Element {
  const sendAccounts = accounts.filter((account) => account.accountId)
  const draftKey = getDraftKey(draft)
  const [formState, setFormState] = React.useState<ComposerFormState>(() =>
    createFormState(draft, draftKey)
  )
  const form = formState.draftKey === draftKey ? formState : createFormState(draft, draftKey)

  async function handleSubmit(action: 'send' | 'draft'): Promise<void> {
    if (!draft) return
    const numericAccountId = Number(form.accountId)
    if (!numericAccountId) {
      updateForm({ error: '请选择发件账号。' })
      return
    }
    if (action === 'send' && form.to.length === 0) {
      updateForm({ error: '请至少填写一个收件人。' })
      return
    }

    updateForm({ error: null })
    const input: SendMessageInput = {
      draftId: draft.draftId,
      kind: draft.kind,
      accountId: numericAccountId,
      relatedMessageId: draft.relatedMessageId,
      to: form.to,
      cc: form.cc,
      bcc: form.bcc,
      subject: form.subject.trim(),
      bodyText: form.bodyText,
      attachments: form.attachments,
      inReplyTo: draft.inReplyTo,
      references: draft.references
    }

    if (action === 'send') {
      await onSend(input)
    } else {
      await onSaveDraft(input)
    }
  }

  async function handleSelectAttachments(): Promise<void> {
    try {
      const selected = await selectMailAttachments()
      if (selected.length === 0) return
      const existingPaths = new Set(form.attachments.map((attachment) => attachment.filePath))
      updateForm({
        attachments: [
          ...form.attachments,
          ...selected.filter((attachment) => !existingPaths.has(attachment.filePath))
        ],
        error: null
      })
    } catch (error) {
      updateForm({
        error: error instanceof Error ? error.message : '选择附件失败。'
      })
    }
  }

  function removeAttachment(filePath?: string): void {
    updateForm({
      attachments: form.attachments.filter((attachment) => attachment.filePath !== filePath)
    })
  }

  function updateForm(patch: Partial<Omit<ComposerFormState, 'draftKey'>>): void {
    setFormState((current) => ({
      ...(current.draftKey === draftKey ? current : createFormState(draft, draftKey)),
      ...patch
    }))
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        if (!pending) onOpenChange(nextOpen)
      }}
    >
      <SheetContent className="w-full sm:max-w-xl">
        <SheetHeader className="border-b">
          <SheetTitle>写邮件</SheetTitle>
          <SheetDescription>使用纯文本发送邮件。</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-auto px-4">
          <FieldGroup className="py-4">
            <Field>
              <FieldLabel htmlFor="composer-account">发件账号</FieldLabel>
              <NativeSelect
                id="composer-account"
                className="w-full"
                value={form.accountId}
                disabled={pending}
                onChange={(event) => updateForm({ accountId: event.target.value })}
              >
                {sendAccounts.map((account) => (
                  <NativeSelectOption key={account.id} value={String(account.accountId)}>
                    {account.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="composer-to">收件人</FieldLabel>
              <AddressInput
                id="composer-to"
                value={form.to}
                disabled={pending}
                placeholder="name@example.com"
                onChange={(value) => updateForm({ to: value })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="composer-cc">抄送</FieldLabel>
              <AddressInput
                id="composer-cc"
                value={form.cc}
                disabled={pending}
                onChange={(value) => updateForm({ cc: value })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="composer-bcc">密送</FieldLabel>
              <AddressInput
                id="composer-bcc"
                value={form.bcc}
                disabled={pending}
                onChange={(value) => updateForm({ bcc: value })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="composer-subject">主题</FieldLabel>
              <Input
                id="composer-subject"
                value={form.subject}
                disabled={pending}
                onChange={(event) => updateForm({ subject: event.target.value })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="composer-body">正文</FieldLabel>
              <Textarea
                id="composer-body"
                value={form.bodyText}
                disabled={pending}
                className="min-h-72 resize-none"
                onChange={(event) => updateForm({ bodyText: event.target.value })}
              />
            </Field>
            <Field>
              <FieldLabel>附件</FieldLabel>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() => {
                    void handleSelectAttachments()
                  }}
                >
                  <Paperclip data-icon="inline-start" />
                  添加附件
                </Button>
                {form.attachments.length > 0 ? (
                  <span className="text-xs text-muted-foreground">
                    {form.attachments.length} 个附件，合计 {formatAttachmentTotal(form.attachments)}
                  </span>
                ) : null}
              </div>
              {form.attachments.length > 0 ? (
                <div className="grid gap-2">
                  {form.attachments.map((attachment) => (
                    <div
                      key={attachment.filePath ?? attachment.filename}
                      className="flex min-h-9 items-center gap-2 rounded-md border px-2 text-xs"
                    >
                      <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">
                        {attachment.filename ?? attachment.filePath ?? '附件'}
                      </span>
                      <span className="shrink-0 text-muted-foreground">
                        {formatBytes(attachment.sizeBytes)}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        disabled={pending}
                        aria-label="移除附件"
                        onClick={() => removeAttachment(attachment.filePath)}
                      >
                        <X />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : null}
            </Field>
            {form.error ? <FieldError>{form.error}</FieldError> : null}
          </FieldGroup>
        </div>
        <SheetFooter className="border-t sm:flex-row sm:justify-end">
          <Button
            variant="outline"
            onClick={() => {
              void handleSubmit('draft')
            }}
            disabled={pending || !draft}
          >
            <Save data-icon="inline-start" />
            存草稿
          </Button>
          <Button
            onClick={() => {
              void handleSubmit('send')
            }}
            disabled={pending || !draft}
          >
            <Send data-icon="inline-start" />
            {pending ? '发送中...' : '发送'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function getDraftKey(draft: ComposeDraft | null): string {
  if (!draft) return 'empty'
  return [
    draft.draftId ?? 'local',
    draft.kind,
    draft.accountId,
    draft.relatedMessageId ?? 'new'
  ].join(':')
}

function createFormState(draft: ComposeDraft | null, draftKey: string): ComposerFormState {
  return {
    draftKey,
    accountId: draft ? String(draft.accountId) : '',
    to: draft?.to ?? [],
    cc: draft?.cc ?? [],
    bcc: draft?.bcc ?? [],
    subject: draft?.subject ?? '',
    bodyText: draft?.bodyText ?? '',
    attachments: draft?.attachments ?? [],
    error: null
  }
}

function formatAttachmentTotal(attachments: MailAttachmentInput[]): string {
  const total = attachments.reduce((sum, attachment) => sum + (attachment.sizeBytes ?? 0), 0)
  return formatBytes(total)
}

function formatBytes(value?: number): string {
  if (!value) return '未知大小'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}
