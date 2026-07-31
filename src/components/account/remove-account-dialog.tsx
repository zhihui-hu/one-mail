import * as React from 'react'

import type { Account } from '@renderer/components/mail/types'
import { ResponsiveDialog } from '@renderer/components/responsive-dialog'
import { Button } from '@renderer/components/ui/button'
import { FieldError } from '@renderer/components/ui/field'
import { useI18n } from '@renderer/lib/i18n'

type RemoveAccountDialogProps = {
  account: Account
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (account: Account) => Promise<void>
}

export function RemoveAccountDialog({
  account,
  open,
  onOpenChange,
  onConfirm
}: RemoveAccountDialogProps): React.JSX.Element {
  const { t } = useI18n()
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  function handleOpenChange(nextOpen: boolean): void {
    if (pending && !nextOpen) return

    if (!nextOpen) {
      setError(null)
    }
    onOpenChange(nextOpen)
  }

  async function handleConfirm(): Promise<void> {
    setPending(true)
    setError(null)

    try {
      await onConfirm(account)
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : t('account.remove.error'))
    } finally {
      setPending(false)
    }
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={t('account.remove.title')}
      description={t('account.remove.description')}
      footer={
        <>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={pending}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              void handleConfirm()
            }}
            disabled={pending || !account.accountId}
          >
            {pending ? t('common.deleting') : t('account.remove.confirm')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2 text-xs text-muted-foreground">
        <p>
          {t('account.remove.summary', { name: account.name })}
        </p>
        <p>{t('account.remove.remoteSafe')}</p>
        {error ? <FieldError>{error}</FieldError> : null}
      </div>
    </ResponsiveDialog>
  )
}
