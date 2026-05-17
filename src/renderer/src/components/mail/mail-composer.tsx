import * as React from 'react'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import {
  ALargeSmall,
  Bold,
  Italic,
  LinkIcon,
  List,
  ListOrdered,
  Maximize2,
  Minimize2,
  Paperclip,
  Save,
  Send,
  Strikethrough,
  Trash2,
  Underline,
  X
} from 'lucide-react'

import { AddressInput } from '@renderer/components/mail/address-input'
import type { Account } from '@renderer/components/mail/types'
import { Button } from '@renderer/components/ui/button'
import { ButtonGroup } from '@renderer/components/ui/button-group'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { Field, FieldError, FieldGroup, FieldLabel } from '@renderer/components/ui/field'
import { Input } from '@renderer/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@renderer/components/ui/native-select'
import { Separator } from '@renderer/components/ui/separator'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@renderer/components/ui/tooltip'
import { cn } from '@renderer/lib/utils'
import { selectMailAttachments, type ComposeDraft, type SendMessageInput } from '@renderer/lib/api'
import { useI18n, type TranslationKey } from '@renderer/lib/i18n'
import type { MailAttachmentInput } from '../../../../shared/types'

type MailComposerProps = {
  open: boolean
  accounts: Account[]
  draft: ComposeDraft | null
  pending?: boolean
  onOpenChange: (open: boolean) => void
  onSend: (input: SendMessageInput) => Promise<void>
  onSaveDraft: (input: SendMessageInput) => Promise<void>
  onDiscardDraft?: (draftId: number) => Promise<void>
}

type ComposerFormState = {
  draftKey: string
  accountId: string
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  bodyText: string
  bodyHtml: string
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
  onSaveDraft,
  onDiscardDraft
}: MailComposerProps): React.JSX.Element {
  const { t } = useI18n()
  const sendAccounts = accounts.filter((account) => account.accountId)
  const draftKey = getDraftKey(draft)
  const [expanded, setExpanded] = React.useState(false)
  const [formattingVisible, setFormattingVisible] = React.useState(false)
  const [ccVisible, setCcVisible] = React.useState(Boolean(draft?.cc?.length))
  const [bccVisible, setBccVisible] = React.useState(Boolean(draft?.bcc?.length))
  const [bodyEditor, setBodyEditor] = React.useState<Editor | null>(null)
  const handleBodyEditorChange = React.useCallback((editor: Editor | null) => {
    setBodyEditor(editor)
  }, [])
  const [formState, setFormState] = React.useState<ComposerFormState>(() =>
    createFormState(draft, draftKey)
  )
  const form = formState.draftKey === draftKey ? formState : createFormState(draft, draftKey)
  const defaultAccount = sendAccounts.find(
    (account) => String(account.accountId) === form.accountId
  )
  const unselectedForwardAttachments = getUnselectedForwardAttachments(draft, form.attachments)

  async function handleSubmit(action: 'send' | 'draft'): Promise<void> {
    if (!draft) return
    if (action === 'send' && form.to.length === 0) {
      updateForm({ error: t('mail.composer.errorRecipientRequired') })
      return
    }

    const input = createSubmitInput()
    if (!input) return

    if (action === 'send') {
      await onSend(input)
    } else {
      await onSaveDraft(input)
    }
    setExpanded(false)
  }

  function createSubmitInput(): SendMessageInput | null {
    if (!draft) return null
    const numericAccountId = Number(form.accountId)
    if (!numericAccountId) {
      updateForm({ error: t('mail.composer.errorAccountRequired') })
      return null
    }

    updateForm({ error: null })
    return {
      draftId: draft.draftId,
      kind: draft.kind,
      accountId: numericAccountId,
      relatedMessageId: draft.relatedMessageId,
      to: form.to,
      cc: form.cc,
      bcc: form.bcc,
      subject: form.subject.trim(),
      bodyText: form.bodyText,
      bodyHtml: normalizeComposerHtml(form.bodyHtml),
      attachments: form.attachments,
      inReplyTo: draft.inReplyTo,
      references: draft.references
    }
  }

  async function handleSelectAttachments(): Promise<void> {
    try {
      const selected = await selectMailAttachments()
      if (selected.length === 0) return
      updateForm((current) => {
        const existingPaths = new Set(current.attachments.map(getAttachmentKey))
        return {
          attachments: [
            ...current.attachments,
            ...selected.filter((attachment) => !existingPaths.has(getAttachmentKey(attachment)))
          ],
          error: null
        }
      })
    } catch (error) {
      updateForm({
        error: error instanceof Error ? error.message : t('mail.composer.errorSelectAttachment')
      })
    }
  }

  function removeAttachment(target: MailAttachmentInput): void {
    const targetKey = getAttachmentKey(target)
    updateForm((current) => ({
      attachments: current.attachments.filter(
        (attachment) => getAttachmentKey(attachment) !== targetKey
      )
    }))
  }

  function updateForm(
    patch:
      | Partial<Omit<ComposerFormState, 'draftKey'>>
      | ((
          current: Omit<ComposerFormState, 'draftKey'>
        ) => Partial<Omit<ComposerFormState, 'draftKey'>>)
  ): void {
    setFormState((current) => ({
      ...resolveFormPatch(current, draft, draftKey, patch)
    }))
  }

  function handleClose(): void {
    setExpanded(false)
    onOpenChange(false)
  }

  async function handleSaveAndClose(): Promise<void> {
    if (!hasDraftContent(form)) {
      handleClose()
      return
    }

    const input = createSubmitInput()
    if (!input) return
    await onSaveDraft(input)
    setExpanded(false)
  }

  async function handleDiscard(): Promise<void> {
    if (!draft?.draftId || !onDiscardDraft) {
      handleClose()
      return
    }

    await onDiscardDraft(draft.draftId)
    setExpanded(false)
  }

  React.useEffect(() => {
    setCcVisible(Boolean(draft?.cc?.length))
    setBccVisible(Boolean(draft?.bcc?.length))
    setFormattingVisible(false)
  }, [draftKey, draft?.bcc?.length, draft?.cc?.length])

  if (!open) return <></>

  return (
    <TooltipProvider>
      <section
        role="dialog"
        aria-modal="false"
        aria-labelledby="mail-composer-title"
        className={cn(
          'app-no-drag fixed right-4 bottom-9 flex max-h-[calc(100vh-5rem)] w-[min(calc(100vw-2rem),38rem)] flex-col overflow-hidden rounded-t-lg border bg-background shadow-2xl',
          expanded &&
            'top-10 bottom-10 w-[min(calc(100vw-2rem),56rem)] sm:right-8 sm:w-[min(calc(100vw-4rem),56rem)]'
        )}
      >
        <header className="flex h-10 shrink-0 items-center justify-between gap-3 bg-muted px-3 text-foreground">
          <div id="mail-composer-title" className="min-w-0 truncate text-sm font-medium">
            {t('mail.composer.newMessage')}
          </div>
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={
                    expanded ? t('mail.composer.restoreWindow') : t('mail.composer.expandWindow')
                  }
                  onClick={() => setExpanded((value) => !value)}
                >
                  {expanded ? <Minimize2 /> : <Maximize2 />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {expanded ? t('mail.composer.restoreWindow') : t('mail.composer.expandWindow')}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t('mail.composer.closeComposer')}
                  disabled={pending}
                  onClick={() => {
                    void handleSaveAndClose()
                  }}
                >
                  <X />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {hasDraftContent(form) ? t('mail.composer.saveAndClose') : t('common.close')}
              </TooltipContent>
            </Tooltip>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-auto">
          <FieldGroup className="gap-0">
            <Field className="min-h-10 border-b px-4 py-1.5" orientation="horizontal">
              <ComposerFieldLabel htmlFor="composer-account">{t('mail.composer.from')}</ComposerFieldLabel>
              <NativeSelect
                id="composer-account"
                size="sm"
                className="min-w-0 flex-1 [&_select]:border-0 [&_select]:bg-transparent [&_select]:shadow-none [&_select]:focus-visible:ring-0"
                value={form.accountId}
                disabled={pending}
                title={defaultAccount?.address}
                onChange={(event) => updateForm({ accountId: event.target.value })}
              >
                {sendAccounts.map((account) => (
                  <NativeSelectOption key={account.id} value={String(account.accountId)}>
                    {account.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field className="min-h-10 border-b px-4 py-1.5" orientation="horizontal">
              <ComposerFieldLabel htmlFor="composer-to">{t('mail.composer.to')}</ComposerFieldLabel>
              <AddressInput
                id="composer-to"
                value={form.to}
                disabled={pending}
                placeholder="name@example.com"
                variant="ghost"
                onChange={(value) => updateForm({ to: value })}
              />
              <RecipientDisclosure
                ccVisible={ccVisible}
                bccVisible={bccVisible}
                disabled={pending}
                onShowCc={() => setCcVisible(true)}
                onShowBcc={() => setBccVisible(true)}
              />
            </Field>
            {ccVisible ? (
              <Field className="min-h-10 border-b px-4 py-1.5" orientation="horizontal">
                <ComposerFieldLabel htmlFor="composer-cc">{t('mail.composer.cc')}</ComposerFieldLabel>
                <AddressInput
                  id="composer-cc"
                  value={form.cc}
                  disabled={pending}
                  variant="ghost"
                  onChange={(value) => updateForm({ cc: value })}
                />
              </Field>
            ) : null}
            {bccVisible ? (
              <Field className="min-h-10 border-b px-4 py-1.5" orientation="horizontal">
                <ComposerFieldLabel htmlFor="composer-bcc">{t('mail.composer.bcc')}</ComposerFieldLabel>
                <AddressInput
                  id="composer-bcc"
                  value={form.bcc}
                  disabled={pending}
                  variant="ghost"
                  onChange={(value) => updateForm({ bcc: value })}
                />
              </Field>
            ) : null}
            <Field className="min-h-10 border-b px-4 py-1.5">
              <Input
                id="composer-subject"
                value={form.subject}
                disabled={pending}
                placeholder={t('mail.composer.subject')}
                className="h-7 border-0 px-0 py-0 shadow-none focus-visible:ring-0"
                onChange={(event) => updateForm({ subject: event.target.value })}
              />
            </Field>
            <MailBodyEditor
              draftKey={draftKey}
              bodyHtml={form.bodyHtml}
              bodyText={form.bodyText}
              disabled={pending}
              expanded={expanded}
              formattingVisible={formattingVisible}
              onEditorChange={handleBodyEditorChange}
              onChange={(value) => updateForm(value)}
            />
            {form.attachments.length > 0 ? (
              <div className="border-t px-3 py-2">
                <div className="mb-2 text-xs text-muted-foreground">
                  {t('mail.composer.attachmentsSummary', {
                    count: form.attachments.length,
                    size: formatAttachmentTotal(form.attachments)
                  })}
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {form.attachments.map((attachment) => (
                    <div
                      key={getAttachmentKey(attachment)}
                      className="flex min-h-9 items-center gap-2 rounded-md border px-2 text-xs"
                    >
                      <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">
                        {attachment.filename ?? attachment.filePath ?? t('mail.composer.attachmentFallback')}
                      </span>
                      <span className="shrink-0 text-muted-foreground">
                        {formatBytes(attachment.sizeBytes)}
                      </span>
                      {attachment.sourceAttachmentId ? (
                        <Checkbox
                          checked
                          disabled={pending}
                          aria-label={t('mail.composer.includeOriginalAttachment')}
                          onCheckedChange={(checked) => {
                            if (checked === false) removeAttachment(attachment)
                          }}
                        />
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          disabled={pending}
                          aria-label={t('mail.composer.removeAttachment')}
                          onClick={() => removeAttachment(attachment)}
                        >
                          <X />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {unselectedForwardAttachments.length > 0 ? (
              <div className="border-t px-3 py-2">
                <div className="mb-2 text-xs text-muted-foreground">
                  {t('mail.composer.originalAttachments')}
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {unselectedForwardAttachments.map((attachment) => (
                    <div
                      key={getAttachmentKey(attachment)}
                      className="flex min-h-9 items-center gap-2 rounded-md border px-2 text-xs"
                    >
                      <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">
                        {attachment.filename ?? t('mail.composer.attachmentFallback')}
                      </span>
                      <span className="shrink-0 text-muted-foreground">
                        {formatBytes(attachment.sizeBytes)}
                      </span>
                      <Checkbox
                        disabled={pending}
                        aria-label={t('mail.composer.includeOriginalAttachment')}
                        onCheckedChange={(checked) => {
                          if (checked !== true) return
                          updateForm((current) => ({
                            attachments: [...current.attachments, attachment]
                          }))
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {form.error ? (
              <FieldError className="border-t px-3 py-2">{form.error}</FieldError>
            ) : null}
          </FieldGroup>
        </div>

        <footer className="flex min-h-16 shrink-0 items-center justify-between gap-2 border-t px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <ButtonGroup className="shrink-0">
              <Button
                className="min-w-24"
                onClick={() => {
                  void handleSubmit('send')
                }}
                disabled={pending || !draft}
              >
                <Send data-icon="inline-start" />
                {pending ? t('common.sending') : t('mail.composer.send')}
              </Button>
              <Button type="button" size="icon" aria-label={t('mail.composer.moreSendOptions')} disabled>
                <span aria-hidden="true">▾</span>
              </Button>
            </ButtonGroup>
            <ComposerToolButton
              label={
                formattingVisible
                  ? t('mail.composer.hideFormatting')
                  : t('mail.composer.showFormatting')
              }
              active={formattingVisible}
              disabled={pending}
              onClick={() => setFormattingVisible((value) => !value)}
            >
              <ALargeSmall />
            </ComposerToolButton>
            <ComposerToolButton
              label={t('mail.composer.addAttachment')}
              disabled={pending}
              onClick={() => {
                void handleSelectAttachments()
              }}
            >
              <Paperclip />
            </ComposerToolButton>
            <ComposerToolButton
              label={t('mail.composer.insertLink')}
              disabled={pending || !bodyEditor}
              onClick={() => setEditorLink(bodyEditor, t)}
            >
              <LinkIcon />
            </ComposerToolButton>
          </div>
          <div className="flex items-center gap-1">
            <ComposerToolButton
              label={t('mail.composer.saveDraft')}
              disabled={pending || !draft}
              onClick={() => {
                void handleSubmit('draft')
              }}
            >
              <Save />
            </ComposerToolButton>
            <ComposerToolButton
              label={hasDraftContent(form) ? t('mail.composer.discardDraft') : t('common.close')}
              disabled={pending}
              onClick={() => {
                void handleDiscard()
              }}
            >
              <Trash2 />
            </ComposerToolButton>
          </div>
        </footer>
      </section>
    </TooltipProvider>
  )
}

function ComposerFieldLabel({
  htmlFor,
  children
}: {
  htmlFor: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <FieldLabel htmlFor={htmlFor} className="w-16 shrink-0 text-muted-foreground">
      {children}
    </FieldLabel>
  )
}

function RecipientDisclosure({
  ccVisible,
  bccVisible,
  disabled,
  onShowCc,
  onShowBcc
}: {
  ccVisible: boolean
  bccVisible: boolean
  disabled: boolean
  onShowCc: () => void
  onShowBcc: () => void
}): React.JSX.Element | null {
  const { t } = useI18n()

  if (ccVisible && bccVisible) return null

  return (
    <div className="flex shrink-0 items-center gap-2 text-sm">
      {!ccVisible ? (
        <button
          type="button"
          className="text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          disabled={disabled}
          onClick={onShowCc}
        >
          {t('mail.composer.cc')}
        </button>
      ) : null}
      {!bccVisible ? (
        <button
          type="button"
          className="text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          disabled={disabled}
          onClick={onShowBcc}
        >
          {t('mail.composer.bcc')}
        </button>
      ) : null}
    </div>
  )
}

function MailBodyEditor({
  draftKey,
  bodyHtml,
  bodyText,
  disabled,
  expanded,
  formattingVisible,
  onEditorChange,
  onChange
}: {
  draftKey: string
  bodyHtml: string
  bodyText: string
  disabled: boolean
  expanded: boolean
  formattingVisible: boolean
  onEditorChange: (editor: Editor | null) => void
  onChange: (patch: Pick<ComposerFormState, 'bodyHtml' | 'bodyText'>) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const lastDraftKeyRef = React.useRef(draftKey)
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        link: false
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        defaultProtocol: 'https'
      }),
      Placeholder.configure({
        placeholder: t('mail.composer.bodyPlaceholder')
      })
    ],
    content: bodyHtml || textToHtml(bodyText),
    editable: !disabled,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        id: 'composer-body',
        class:
          'prose-mail min-h-full px-3 py-3 text-sm leading-6 outline-none break-words focus-visible:outline-none'
      }
    },
    onUpdate: ({ editor: currentEditor }) => {
      onChange({
        bodyHtml: currentEditor.getHTML(),
        bodyText: currentEditor.getText({ blockSeparator: '\n\n' })
      })
    }
  }, [t])

  React.useEffect(() => {
    editor?.setEditable(!disabled)
  }, [disabled, editor])

  React.useEffect(() => {
    onEditorChange(editor)
    return () => onEditorChange(null)
  }, [editor, onEditorChange])

  React.useEffect(() => {
    if (!editor) return
    if (lastDraftKeyRef.current === draftKey) return
    lastDraftKeyRef.current = draftKey
    editor.commands.setContent(bodyHtml || textToHtml(bodyText), { emitUpdate: false })
  }, [bodyHtml, bodyText, draftKey, editor])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {formattingVisible ? <EditorToolbar editor={editor} disabled={disabled} /> : null}
      <div
        className={cn('min-h-80 overflow-auto', expanded ? 'min-h-[28rem]' : 'max-h-[42vh]')}
        onClick={() => editor?.commands.focus()}
      >
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}

function EditorToolbar({
  editor,
  disabled
}: {
  editor: Editor | null
  disabled: boolean
}): React.JSX.Element {
  const { t } = useI18n()

  return (
    <div className="flex min-h-10 shrink-0 items-center gap-1 border-b bg-muted/50 px-3">
      <FormatButton
        label={t('mail.composer.bold')}
        active={editor?.isActive('bold')}
        disabled={disabled || !editor}
        onClick={() => editor?.chain().focus().toggleBold().run()}
      >
        <Bold />
      </FormatButton>
      <FormatButton
        label={t('mail.composer.italic')}
        active={editor?.isActive('italic')}
        disabled={disabled || !editor}
        onClick={() => editor?.chain().focus().toggleItalic().run()}
      >
        <Italic />
      </FormatButton>
      <FormatButton
        label={t('mail.composer.underline')}
        active={editor?.isActive('underline')}
        disabled={disabled || !editor}
        onClick={() => editor?.chain().focus().toggleUnderline().run()}
      >
        <Underline />
      </FormatButton>
      <FormatButton
        label={t('mail.composer.strikethrough')}
        active={editor?.isActive('strike')}
        disabled={disabled || !editor}
        onClick={() => editor?.chain().focus().toggleStrike().run()}
      >
        <Strikethrough />
      </FormatButton>
      <Separator orientation="vertical" className="mx-1 h-5" />
      <FormatButton
        label={t('mail.composer.bulletList')}
        active={editor?.isActive('bulletList')}
        disabled={disabled || !editor}
        onClick={() => editor?.chain().focus().toggleBulletList().run()}
      >
        <List />
      </FormatButton>
      <FormatButton
        label={t('mail.composer.orderedList')}
        active={editor?.isActive('orderedList')}
        disabled={disabled || !editor}
        onClick={() => editor?.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered />
      </FormatButton>
      <FormatButton
        label={t('mail.composer.link')}
        active={editor?.isActive('link')}
        disabled={disabled || !editor}
        onClick={() => setEditorLink(editor, t)}
      >
        <LinkIcon />
      </FormatButton>
    </div>
  )
}

function ComposerToolButton({
  label,
  active,
  disabled,
  onClick,
  children
}: {
  label: string
  active?: boolean
  disabled?: boolean
  onClick?: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={active ? 'secondary' : 'ghost'}
          size="icon-sm"
          aria-label={label}
          aria-pressed={active}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function FormatButton({
  label,
  active,
  disabled,
  onClick,
  children
}: {
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={active ? 'secondary' : 'ghost'}
          size="icon-sm"
          aria-label={label}
          aria-pressed={active}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function setEditorLink(
  editor: Editor | null,
  t: (key: TranslationKey) => string
): void {
  if (!editor) return
  const previousUrl = editor.getAttributes('link').href as string | undefined
  const url = window.prompt(t('mail.composer.linkPrompt'), previousUrl ?? 'https://')
  if (url === null) return
  if (!url.trim()) {
    editor.chain().focus().extendMarkRange('link').unsetLink().run()
    return
  }

  editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run()
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
    bodyHtml: draft?.bodyHtml ?? textToHtml(draft?.bodyText ?? ''),
    attachments: draft?.attachments ?? [],
    error: null
  }
}

function resolveFormPatch(
  current: ComposerFormState,
  draft: ComposeDraft | null,
  draftKey: string,
  patch:
    | Partial<Omit<ComposerFormState, 'draftKey'>>
    | ((
        current: Omit<ComposerFormState, 'draftKey'>
      ) => Partial<Omit<ComposerFormState, 'draftKey'>>)
): ComposerFormState {
  const base = current.draftKey === draftKey ? current : createFormState(draft, draftKey)
  const nextPatch = typeof patch === 'function' ? patch(base) : patch
  return {
    ...base,
    ...nextPatch
  }
}

export function getAttachmentKey(attachment: MailAttachmentInput): string {
  return attachment.sourceAttachmentId
    ? `source:${attachment.sourceMessageId ?? ''}:${attachment.sourceAttachmentId}`
    : (attachment.filePath ?? attachment.filename ?? '')
}

export function getUnselectedForwardAttachments(
  draft: ComposeDraft | null,
  selectedAttachments: MailAttachmentInput[]
): MailAttachmentInput[] {
  const selectedKeys = new Set(selectedAttachments.map(getAttachmentKey))
  return (draft?.forwardAttachments ?? []).filter(
    (attachment) => !selectedKeys.has(getAttachmentKey(attachment))
  )
}

function normalizeComposerHtml(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed && trimmed !== '<p></p>' ? trimmed : undefined
}

function hasDraftContent(form: ComposerFormState): boolean {
  return (
    form.to.length > 0 ||
    form.cc.length > 0 ||
    form.bcc.length > 0 ||
    Boolean(form.subject.trim()) ||
    Boolean(form.bodyText.trim()) ||
    Boolean(normalizeComposerHtml(form.bodyHtml)) ||
    form.attachments.length > 0
  )
}

function textToHtml(value: string): string {
  const normalized = value.replace(/\r?\n/g, '\n')
  if (!normalized.trim()) return ''
  return normalized
    .split(/\n{2,}/)
    .map((paragraph) => {
      const lines = paragraph.split('\n').map(escapeHtml).join('<br>')
      return `<p>${lines || '<br>'}</p>`
    })
    .join('')
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatAttachmentTotal(attachments: MailAttachmentInput[]): string {
  const total = attachments.reduce((sum, attachment) => sum + (attachment.sizeBytes ?? 0), 0)
  return formatBytes(total, '')
}

function formatBytes(value?: number, fallback = ''): string {
  if (!value) return fallback
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}
