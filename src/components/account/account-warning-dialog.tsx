import * as React from 'react'
import { AlertTriangle, KeyRound, RefreshCw } from 'lucide-react'

import type { Account } from '@renderer/components/mail/types'
import { Alert, AlertDescription, AlertTitle } from '@renderer/components/ui/alert'
import { Button } from '@renderer/components/ui/button'
import { FieldError } from '@renderer/components/ui/field'
import { useI18n } from '@renderer/lib/i18n'
import { getAccountWarning, type AccountWarningAction } from './account-warning'

type AccountWarningDialogProps = {
  account: Account
  open: boolean
  syncing?: boolean
  onOpenChange: (open: boolean) => void
  onEdit: (account: Account) => void
  onRetry: (account: Account) => void
  onDelete: (account: Account) => void
  onReauthorize: (account: Account) => Promise<void>
}

export function AccountWarningDialog({
  account,
  open,
  syncing = false,
  onOpenChange,
  onEdit,
  onRetry,
  onDelete,
  onReauthorize
}: AccountWarningDialogProps): React.JSX.Element {
  const { t } = useI18n()
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const warning = getAccountWarning(account, t)

  function handleOpenChange(nextOpen: boolean): void {
    if (pending && !nextOpen) return
    if (!nextOpen) setError(null)
    onOpenChange(nextOpen)
  }

  async function runAction(action?: AccountWarningAction): Promise<void> {
    if (!action) return

    if (action === 'reauthorize') {
      setPending(true)
      setError(null)
      try {
        await onReauthorize(account)
        setPending(false)
        handleOpenChange(false)
      } catch (reauthorizeError) {
        setError(
          reauthorizeError instanceof Error
            ? reauthorizeError.message
            : t('account.warning.reauthorizeError')
        )
        setPending(false)
      }
      return
    }

    handleOpenChange(false)

    if (action === 'edit') {
      onEdit(account)
      return
    }

    if (action === 'delete') {
      onDelete(account)
      return
    }

    onRetry(account)
  }

  const disabled = syncing || pending

  if (!open) return <></>

  return (
    <aside className="app-no-drag fixed right-4 bottom-10 z-40 w-[min(380px,calc(100vw-2rem))] rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">
            {warning?.title ?? t('account.warning.dialogFallbackTitle')}
          </h2>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {t('account.warning.dialogDescription', { account: account.name })}
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs"
          onClick={() => handleOpenChange(false)}
          disabled={pending}
        >
          {t('common.later')}
        </Button>
      </div>

      {warning ? (
        <div className="flex flex-col gap-3">
          <Alert variant="warning">
            <AlertTriangle aria-hidden="true" strokeWidth={2} />
            <AlertTitle>{warning.title}</AlertTitle>
            <AlertDescription>{warning.message}</AlertDescription>
          </Alert>

          <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-xs text-foreground">
            {warning.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          {error ? <FieldError>{error}</FieldError> : null}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t('account.warning.noAction')}</p>
      )}

      <div className="mt-3 flex justify-end gap-2">
        {warning ? (
          <>
            {warning.secondaryAction ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void runAction(warning.secondaryAction)
                }}
                disabled={disabled}
              >
                {warning.secondaryAction === 'retry' ? (
                  <RefreshCw data-icon="inline-start" />
                ) : null}
                {warning.secondaryLabel}
              </Button>
            ) : null}
            <Button
              size="sm"
              onClick={() => {
                void runAction(warning.primaryAction)
              }}
              disabled={disabled}
            >
              {warning.primaryAction === 'retry' ? <RefreshCw data-icon="inline-start" /> : null}
              {warning.primaryAction === 'reauthorize' ? (
                <KeyRound data-icon="inline-start" />
              ) : null}
              {pending ? t('account.warning.authorizing') : warning.primaryLabel}
            </Button>
          </>
        ) : (
          <Button size="sm" onClick={() => handleOpenChange(false)}>
            {t('common.ok')}
          </Button>
        )}
      </div>
    </aside>
  )
}
