import { Bot, Send, Sparkles } from 'lucide-react'
import * as React from 'react'

import { ResponsiveDialog } from '@renderer/components/responsive-dialog'
import { SweepShine } from '@renderer/components/sweep-shine'
import { Alert, AlertTitle } from '@renderer/components/ui/alert'
import { Button } from '@renderer/components/ui/button'
import { Switch } from '@renderer/components/ui/switch'
import { Textarea } from '@renderer/components/ui/textarea'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@renderer/components/ui/tooltip'
import { useI18n } from '@renderer/lib/i18n'
import type {
  AiChatInput,
  AiChatMessage,
  AiChatResult,
  AiSettings
} from '@renderer/shared/types'

type AiAssistantProps = {
  settings: AiSettings
  launcherHidden?: boolean
  messageId?: number
  messageSubject?: string
  onChat: (input: AiChatInput) => Promise<AiChatResult>
}

export function AiAssistant({
  settings,
  launcherHidden = false,
  messageId,
  messageSubject,
  onChat
}: AiAssistantProps): React.JSX.Element {
  const { t } = useI18n()
  const [open, setOpen] = React.useState(false)
  const [messages, setMessages] = React.useState<AiChatMessage[]>([])
  const [draft, setDraft] = React.useState('')
  const [attachCurrentMessage, setAttachCurrentMessage] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const attachMessageSwitchId = React.useId()
  const launcherRef = React.useRef<HTMLButtonElement | null>(null)
  const messagesEndRef = React.useRef<HTMLDivElement | null>(null)
  const requestTokenRef = React.useRef(0)

  React.useEffect(() => {
    requestTokenRef.current += 1
    setMessages([])
    setDraft('')
    setAttachCurrentMessage(false)
    setPending(false)
    setError(null)
  }, [messageId, settings.baseUrl, settings.model, settings.verifiedAt])

  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: 'nearest' })
  }, [messages, pending])

  async function sendMessage(
    content: string,
    includeCurrentMessage = attachCurrentMessage
  ): Promise<void> {
    const normalizedContent = content.trim()
    if (!normalizedContent || pending) return

    const requestToken = requestTokenRef.current + 1
    requestTokenRef.current = requestToken
    const userMessage: AiChatMessage = { role: 'user', content: normalizedContent }
    const requestMessages = [...messages, userMessage]
    setMessages(requestMessages)
    setDraft('')
    setPending(true)
    setError(null)

    try {
      const result = await onChat({
        ...(includeCurrentMessage && messageId !== undefined ? { messageId } : {}),
        messages: requestMessages
      })
      if (requestTokenRef.current !== requestToken) return
      setMessages((current) => [...current, result.message])
    } catch (chatError) {
      if (requestTokenRef.current !== requestToken) return
      setError(chatError instanceof Error ? chatError.message : t('ai.chat.error'))
    } finally {
      if (requestTokenRef.current === requestToken) setPending(false)
    }
  }

  function sendQuickPrompt(prompt: string): void {
    setAttachCurrentMessage(true)
    void sendMessage(prompt, true)
  }

  const hasCurrentMessage = messageId !== undefined
  const currentMessageSubject = messageSubject?.trim() || t('common.noSubject')
  const contextLabel = !hasCurrentMessage
    ? t('ai.chat.noContext')
    : attachCurrentMessage
      ? t('ai.chat.contextAttached', { subject: currentMessageSubject })
      : t('ai.chat.contextDetached')
  const attachMessageDescription = !hasCurrentMessage
    ? t('ai.chat.attachUnavailable')
    : attachCurrentMessage
      ? t('ai.chat.attachEnabled', { subject: currentMessageSubject })
      : t('ai.chat.attachDisabled')
  const serviceHost = getServiceHost(settings.baseUrl)

  function handleOpenChange(nextOpen: boolean): void {
    setOpen(nextOpen)
    if (!nextOpen) {
      window.setTimeout(() => launcherRef.current?.focus(), 0)
    }
  }

  return (
    <>
      {!launcherHidden ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                ref={launcherRef}
                type="button"
                size="icon-lg"
                className="app-no-drag fixed right-5 bottom-10 z-30 size-11 rounded-full shadow-[0_12px_32px_rgb(0_0_0/0.24)]"
                aria-label={t('ai.launcher')}
                onClick={() => setOpen(true)}
              >
                <Sparkles className="size-5" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">{t('ai.launcher')}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : null}

      <ResponsiveDialog
        open={open}
        onOpenChange={handleOpenChange}
        title={t('ai.chat.title')}
        description={t('ai.chat.description', { model: settings.model, service: serviceHost })}
        contentClassName="h-[min(680px,90dvh)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-lg p-0 sm:max-w-xl"
        headerClassName="shrink-0 border-b bg-background px-4 py-3 pr-12"
        bodyClassName="h-full min-h-0 overflow-hidden"
      >
        <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]">
          <div className="grid gap-2 border-b bg-muted/25 px-4 py-2 text-xs text-muted-foreground">
            <div aria-live="polite">
              <span className="font-medium text-foreground">{t('ai.chat.context')}</span>{' '}
              <span className="break-words" title={contextLabel}>
                {contextLabel}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <label
                  className="font-medium text-foreground"
                  htmlFor={attachMessageSwitchId}
                >
                  {t('ai.chat.attachCurrentMessage')}
                </label>
                <p id={`${attachMessageSwitchId}-description`} className="break-words">
                  {attachMessageDescription}
                </p>
              </div>
              <Switch
                id={attachMessageSwitchId}
                size="sm"
                checked={attachCurrentMessage}
                disabled={!hasCurrentMessage || pending}
                aria-describedby={`${attachMessageSwitchId}-description`}
                onCheckedChange={setAttachCurrentMessage}
              />
            </div>
          </div>

          <div
            className="min-h-0 overflow-y-auto px-4 py-3"
            role="log"
            aria-live="polite"
            aria-relevant="additions text"
          >
            {messages.length === 0 ? (
              <div className="flex min-h-full flex-col items-center justify-center gap-2 py-6 text-center">
                <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Bot className="size-5" aria-hidden="true" />
                </div>
                <div className="text-sm font-medium">{t('ai.chat.emptyTitle')}</div>
                <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
                  {attachCurrentMessage
                    ? t('ai.chat.emptyWithContext')
                    : t('ai.chat.emptyDescription')}
                </p>
                <p className="max-w-sm text-[11px] leading-relaxed text-muted-foreground">
                  {t('ai.chat.privacyNotice')}
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {messages.map((message, index) => (
                  <ChatMessageBubble key={`${message.role}-${index}`} message={message} />
                ))}
                {pending ? (
                  <div className="flex justify-start">
                    <div className="max-w-[88%] rounded-xl rounded-bl-sm bg-muted px-3 py-2 text-sm">
                      <SweepShine>{t('ai.chat.thinking')}</SweepShine>
                    </div>
                  </div>
                ) : null}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          <form
            className="grid gap-2 border-t bg-background p-3"
            onSubmit={(event) => {
              event.preventDefault()
              void sendMessage(draft)
            }}
          >
            <div className="flex flex-wrap gap-1.5" aria-label={t('ai.chat.quickActions')}>
              <QuickPromptButton
                label={t('ai.chat.quickSummary')}
                disabled={!hasCurrentMessage || pending}
                onClick={() => sendQuickPrompt(t('ai.chat.quickSummaryPrompt'))}
              />
              <QuickPromptButton
                label={t('ai.chat.quickTasks')}
                disabled={!hasCurrentMessage || pending}
                onClick={() => sendQuickPrompt(t('ai.chat.quickTasksPrompt'))}
              />
              <QuickPromptButton
                label={t('ai.chat.quickReply')}
                disabled={!hasCurrentMessage || pending}
                onClick={() => sendQuickPrompt(t('ai.chat.quickReplyPrompt'))}
              />
            </div>
            {error ? (
              <Alert variant="destructive">
                <AlertTitle>{error}</AlertTitle>
              </Alert>
            ) : null}
            <div className="flex items-end gap-2">
              <Textarea
                className="max-h-36 min-h-16 resize-none"
                value={draft}
                disabled={pending}
                placeholder={t('ai.chat.placeholder')}
                aria-label={t('ai.chat.placeholder')}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key !== 'Enter' ||
                    event.shiftKey ||
                    event.nativeEvent.isComposing
                  ) {
                    return
                  }
                  event.preventDefault()
                  event.currentTarget.form?.requestSubmit()
                }}
              />
              <Button
                type="submit"
                size="icon-lg"
                disabled={pending || !draft.trim()}
                aria-label={t('ai.chat.send')}
              >
                <Send aria-hidden="true" />
              </Button>
            </div>
          </form>
        </div>
      </ResponsiveDialog>
    </>
  )
}

function ChatMessageBubble({ message }: { message: AiChatMessage }): React.JSX.Element {
  const user = message.role === 'user'

  return (
    <div className={user ? 'flex justify-end' : 'flex justify-start'}>
      <div
        className={`max-w-[88%] rounded-xl px-3 py-2 text-sm leading-relaxed ${
          user
            ? 'rounded-br-sm bg-primary text-primary-foreground'
            : 'rounded-bl-sm bg-muted text-foreground'
        }`}
      >
        <p className="whitespace-pre-wrap break-words">{message.content}</p>
      </div>
    </div>
  )
}

function QuickPromptButton({
  label,
  disabled,
  onClick
}: {
  label: string
  disabled: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <Button type="button" variant="outline" size="xs" disabled={disabled} onClick={onClick}>
      {label}
    </Button>
  )
}

function getServiceHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host
  } catch {
    return baseUrl
  }
}
