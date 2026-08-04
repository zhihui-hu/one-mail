import * as React from 'react'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import { EditorContent, Extension, useEditor, type Attribute, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Check,
  Italic,
  LinkIcon,
  List,
  ListOrdered,
  Maximize2,
  Minimize2,
  Paperclip,
  Redo,
  Save,
  Send,
  Strikethrough,
  Trash2,
  Underline,
  Unlink,
  Undo,
  X
} from 'lucide-react'

import { AddressInput } from '@renderer/components/mail/address-input'
import type { Account } from '@renderer/components/mail/types'
import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { Field, FieldError, FieldGroup, FieldLabel } from '@renderer/components/ui/field'
import { Input } from '@renderer/components/ui/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput
} from '@renderer/components/ui/input-group'
import { NativeSelect, NativeSelectOption } from '@renderer/components/ui/native-select'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import { Separator } from '@renderer/components/ui/separator'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@renderer/components/ui/tooltip'
import { cn } from '@renderer/lib/utils'
import {
  selectMailAttachments,
  type ComposeDraft,
  type SendMessageInput
} from '@renderer/pages/mailbox/api'
import { useI18n } from '@renderer/lib/i18n'
import type { MailAttachmentInput } from '@renderer/shared/types'

const COMPOSER_ADDRESS_FIELD_CLASS =
  'min-h-9 items-center gap-2 border-b px-3 py-1 *:data-[slot=field-label]:flex-none'
const COMPOSER_TEXT_ALIGNMENTS = ['left', 'center', 'right'] as const

type ComposerTextAlign = (typeof COMPOSER_TEXT_ALIGNMENTS)[number]
type EditorSelectionRange = { from: number; to: number }

const ComposerTextAlignExtension = Extension.create({
  name: 'composerTextAlign',

  addGlobalAttributes() {
    return [
      {
        types: ['heading', 'paragraph'],
        attributes: {
          textAlign: createTextAlignAttribute()
        }
      }
    ]
  }
})

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
  const [ccVisible, setCcVisible] = React.useState(Boolean(draft?.cc?.length))
  const [bccVisible, setBccVisible] = React.useState(Boolean(draft?.bcc?.length))
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
  }, [draftKey, draft?.bcc?.length, draft?.cc?.length])

  if (!open) return <></>

  return (
    <TooltipProvider>
      <section
        role="dialog"
        aria-modal="false"
        aria-labelledby="mail-composer-title"
        className={cn(
          'app-no-drag fixed right-5 bottom-5 z-40 flex max-h-[calc(100vh-3rem)] w-[min(calc(100vw-2rem),38rem)] flex-col overflow-hidden rounded-xl border border-black/10 bg-background shadow-[0_24px_70px_rgb(0_0_0/0.28)] dark:border-white/12',
          expanded &&
            'top-8 bottom-8 w-[min(calc(100vw-2rem),56rem)] sm:right-8 sm:w-[min(calc(100vw-4rem),56rem)]'
        )}
      >
        <header className="flex h-9 shrink-0 items-center justify-between gap-3 border-b bg-muted/45 px-3 text-foreground">
          <div id="mail-composer-title" className="min-w-0 truncate text-xs font-semibold">
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
            <Field className={COMPOSER_ADDRESS_FIELD_CLASS} orientation="horizontal">
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
            <Field className={COMPOSER_ADDRESS_FIELD_CLASS} orientation="horizontal">
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
              <Field className={COMPOSER_ADDRESS_FIELD_CLASS} orientation="horizontal">
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
              <Field className={COMPOSER_ADDRESS_FIELD_CLASS} orientation="horizontal">
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
            <Field className="min-h-9 border-b px-3 py-1">
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
              onChange={(value) => updateForm(value)}
            />
            {form.attachments.length > 0 ? (
              <div className="border-t bg-muted/15 px-3 py-2">
                <div className="mb-1.5 text-[11px] text-muted-foreground">
                  {t('mail.composer.attachmentsSummary', {
                    count: form.attachments.length,
                    size: formatAttachmentTotal(form.attachments)
                  })}
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {form.attachments.map((attachment) => (
                    <div
                      key={getAttachmentKey(attachment)}
                      className="flex min-h-8 items-center gap-2 rounded-md border bg-background px-2 text-xs"
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
              <div className="border-t bg-muted/15 px-3 py-2">
                <div className="mb-1.5 text-[11px] text-muted-foreground">
                  {t('mail.composer.originalAttachments')}
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {unselectedForwardAttachments.map((attachment) => (
                    <div
                      key={getAttachmentKey(attachment)}
                      className="flex min-h-8 items-center gap-2 rounded-md border bg-background px-2 text-xs"
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

        <footer className="flex min-h-12 shrink-0 items-center justify-between gap-2 border-t bg-muted/15 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <Button
              className="h-8 min-w-20 shrink-0 rounded-lg"
              onClick={() => {
                void handleSubmit('send')
              }}
              disabled={pending || !draft}
            >
              <Send data-icon="inline-start" />
              {pending ? t('common.sending') : t('mail.composer.send')}
            </Button>
            <ComposerToolButton
              label={t('mail.composer.addAttachment')}
              disabled={pending}
              onClick={() => {
                void handleSelectAttachments()
              }}
            >
              <Paperclip />
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
    <FieldLabel
      htmlFor={htmlFor}
      className="w-12 shrink-0 justify-start text-left text-xs text-muted-foreground"
    >
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
    <div className="flex shrink-0 items-center gap-1.5 text-xs">
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
  onChange
}: {
  draftKey: string
  bodyHtml: string
  bodyText: string
  disabled: boolean
  expanded: boolean
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
      ComposerTextAlignExtension,
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
        class: 'composer-body min-h-full px-4 py-3 outline-none break-words focus-visible:outline-none'
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
    if (!editor) return
    if (lastDraftKeyRef.current === draftKey) return
    lastDraftKeyRef.current = draftKey
    editor.commands.setContent(bodyHtml || textToHtml(bodyText), { emitUpdate: false })
  }, [bodyHtml, bodyText, draftKey, editor])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-9 shrink-0 items-center border-b bg-muted/20 px-2.5 py-1">
        <EditorToolbar editor={editor} disabled={disabled} />
      </div>
      <div
        className={cn('min-h-64 overflow-auto', expanded ? 'min-h-[28rem]' : 'max-h-[42vh]')}
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
  const [, rerenderToolbar] = React.useReducer((count: number) => count + 1, 0)

  React.useEffect(() => {
    if (!editor) return

    editor.on('transaction', rerenderToolbar)
    editor.on('selectionUpdate', rerenderToolbar)
    editor.on('update', rerenderToolbar)

    return () => {
      editor.off('transaction', rerenderToolbar)
      editor.off('selectionUpdate', rerenderToolbar)
      editor.off('update', rerenderToolbar)
    }
  }, [editor])

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      <FormatButton
        label={t('mail.composer.undo')}
        disabled={disabled || !editor || !editor.can().undo()}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => editor?.chain().focus().undo().run()}
      >
        <Undo />
      </FormatButton>
      <FormatButton
        label={t('mail.composer.redo')}
        disabled={disabled || !editor || !editor.can().redo()}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => editor?.chain().focus().redo().run()}
      >
        <Redo />
      </FormatButton>
      <Separator orientation="vertical" className="mx-0.5 h-4" />
      <FormatButton
        label={t('mail.composer.bold')}
        active={editor?.isActive('bold')}
        disabled={disabled || !editor}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => editor?.chain().focus().toggleBold().run()}
      >
        <Bold />
      </FormatButton>
      <FormatButton
        label={t('mail.composer.italic')}
        active={editor?.isActive('italic')}
        disabled={disabled || !editor}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => editor?.chain().focus().toggleItalic().run()}
      >
        <Italic />
      </FormatButton>
      <FormatButton
        label={t('mail.composer.underline')}
        active={editor?.isActive('underline')}
        disabled={disabled || !editor}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => editor?.chain().focus().toggleUnderline().run()}
      >
        <Underline />
      </FormatButton>
      <FormatButton
        label={t('mail.composer.strikethrough')}
        active={editor?.isActive('strike')}
        disabled={disabled || !editor}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => editor?.chain().focus().toggleStrike().run()}
      >
        <Strikethrough />
      </FormatButton>
      <Separator orientation="vertical" className="mx-0.5 h-4" />
      <FormatButton
        label={t('mail.composer.bulletList')}
        active={editor?.isActive('bulletList')}
        disabled={disabled || !editor}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => editor?.chain().focus().toggleBulletList().run()}
      >
        <List />
      </FormatButton>
      <FormatButton
        label={t('mail.composer.orderedList')}
        active={editor?.isActive('orderedList')}
        disabled={disabled || !editor}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => editor?.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered />
      </FormatButton>
      <Separator orientation="vertical" className="mx-0.5 h-4" />
      <FormatButton
        label={t('mail.composer.alignLeft')}
        active={isTextAlignActive(editor, 'left')}
        disabled={disabled || !editor}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setComposerTextAlign(editor, 'left')}
      >
        <AlignLeft />
      </FormatButton>
      <FormatButton
        label={t('mail.composer.alignCenter')}
        active={isTextAlignActive(editor, 'center')}
        disabled={disabled || !editor}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setComposerTextAlign(editor, 'center')}
      >
        <AlignCenter />
      </FormatButton>
      <FormatButton
        label={t('mail.composer.alignRight')}
        active={isTextAlignActive(editor, 'right')}
        disabled={disabled || !editor}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setComposerTextAlign(editor, 'right')}
      >
        <AlignRight />
      </FormatButton>
      <Separator orientation="vertical" className="mx-0.5 h-4" />
      <LinkFormatButton editor={editor} disabled={disabled} />
    </div>
  )
}

function LinkFormatButton({
  editor,
  disabled
}: {
  editor: Editor | null
  disabled: boolean
}): React.JSX.Element {
  const { t } = useI18n()
  const [open, setOpen] = React.useState(false)
  const [url, setUrl] = React.useState('')
  const savedRangeRef = React.useRef<EditorSelectionRange | null>(null)
  const active = Boolean(editor?.isActive('link'))
  const unavailable = disabled || !editor

  function saveSelection(): void {
    if (!editor) return
    savedRangeRef.current = {
      from: editor.state.selection.from,
      to: editor.state.selection.to
    }
    setUrl((editor.getAttributes('link').href as string | undefined) ?? '')
  }

  function handleOpenChange(nextOpen: boolean): void {
    if (nextOpen) saveSelection()
    setOpen(nextOpen)
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    applyEditorLink(editor, url, savedRangeRef.current)
    setOpen(false)
  }

  function handleRemove(): void {
    removeEditorLink(editor, savedRangeRef.current)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant={active ? 'secondary' : 'ghost'}
          size="icon-xs"
          aria-label={t('mail.composer.link')}
          aria-pressed={active}
          disabled={unavailable}
          onMouseDown={(event) => {
            event.preventDefault()
            saveSelection()
          }}
        >
          <LinkIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <form onSubmit={handleSubmit}>
          <InputGroup>
            <InputGroupInput
              value={url}
              autoFocus
              aria-label={t('mail.composer.linkPrompt')}
              placeholder={t('mail.composer.linkPlaceholder')}
              onChange={(event) => setUrl(event.target.value)}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label={t('mail.composer.removeLink')}
                disabled={!active && !url.trim()}
                onClick={handleRemove}
              >
                <Unlink />
              </InputGroupButton>
              <InputGroupButton
                type="submit"
                size="icon-xs"
                variant="default"
                aria-label={t('mail.composer.applyLink')}
              >
                <Check />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </form>
      </PopoverContent>
    </Popover>
  )
}

function ComposerToolButton({
  label,
  active,
  disabled,
  onMouseDown,
  onClick,
  children
}: {
  label: string
  active?: boolean
  disabled?: boolean
  onMouseDown?: (event: React.MouseEvent<HTMLButtonElement>) => void
  onClick?: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={active ? 'secondary' : 'ghost'}
          size="icon-xs"
          aria-label={label}
          aria-pressed={active}
          disabled={disabled}
          onMouseDown={onMouseDown}
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
  onMouseDown,
  onClick,
  children
}: {
  label: string
  active?: boolean
  disabled?: boolean
  onMouseDown?: (event: React.MouseEvent<HTMLButtonElement>) => void
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={active ? 'secondary' : 'ghost'}
          size="icon-xs"
          aria-label={label}
          aria-pressed={active}
          disabled={disabled}
          onMouseDown={onMouseDown}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function createTextAlignAttribute(): Attribute {
  return {
    default: null,
    parseHTML: (element) => {
      const value = element.style.textAlign
      return isComposerTextAlign(value) ? value : null
    },
    renderHTML: (attributes) => {
      const value = attributes.textAlign
      if (!isComposerTextAlign(value)) return null
      return { style: `text-align: ${value}` }
    }
  }
}

function isComposerTextAlign(value: unknown): value is ComposerTextAlign {
  return typeof value === 'string' && COMPOSER_TEXT_ALIGNMENTS.includes(value as ComposerTextAlign)
}

function setComposerTextAlign(editor: Editor | null, textAlign: ComposerTextAlign): void {
  if (!editor) return

  editor
    .chain()
    .focus()
    .updateAttributes('paragraph', { textAlign })
    .updateAttributes('heading', { textAlign })
    .run()
}

function isTextAlignActive(editor: Editor | null, textAlign: ComposerTextAlign): boolean {
  if (!editor) return false
  return editor.isActive({ textAlign }) || (textAlign === 'left' && !hasTextAlign(editor))
}

function hasTextAlign(editor: Editor): boolean {
  return COMPOSER_TEXT_ALIGNMENTS.some((textAlign) => editor.isActive({ textAlign }))
}

function applyEditorLink(
  editor: Editor | null,
  value: string,
  range: EditorSelectionRange | null
): void {
  if (!editor) return

  restoreEditorSelection(editor, range)

  if (!value.trim()) {
    removeEditorLink(editor, range)
    return
  }

  const href = normalizeLinkUrl(value)

  if (editor.isActive('link')) {
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
    return
  }

  if (editor.state.selection.empty) {
    editor
      .chain()
      .focus()
      .insertContent(`<a href="${escapeHtmlAttribute(href)}">${escapeHtml(href)}</a>`)
      .unsetLink()
      .run()
    return
  }

  editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
}

function removeEditorLink(editor: Editor | null, range: EditorSelectionRange | null): void {
  if (!editor) return
  restoreEditorSelection(editor, range)
  editor.chain().focus().extendMarkRange('link').unsetLink().run()
}

function restoreEditorSelection(editor: Editor, range: EditorSelectionRange | null): void {
  if (!range) {
    editor.commands.focus()
    return
  }

  const docSize = editor.state.doc.content.size
  editor.commands.setTextSelection({
    from: Math.min(range.from, docSize),
    to: Math.min(range.to, docSize)
  })
  editor.commands.focus()
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

function escapeHtmlAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, '&#96;')
}

function normalizeLinkUrl(value: string): string {
  const url = value.trim()
  return /^[a-z][a-z\d+.-]*:/i.test(url) ? url : `https://${url}`
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
