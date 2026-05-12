import * as React from 'react'

import type { Account } from '@renderer/components/mail/types'
import { ResponsiveDialog } from '@renderer/components/responsive-dialog'
import { Button } from '@renderer/components/ui/button'
import { FieldError } from '@renderer/components/ui/field'

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
      setError(confirmError instanceof Error ? confirmError.message : '删除账号失败。')
    } finally {
      setPending(false)
    }
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={handleOpenChange}
      title="删除账号"
      description="从 OneMail 删除这个本地账号配置。"
      footer={
        <>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={pending}>
            取消
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              void handleConfirm()
            }}
            disabled={pending || !account.accountId}
          >
            {pending ? '删除中...' : '删除本地配置'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2 text-xs text-muted-foreground">
        <p>
          将删除 <span className="text-foreground">{account.name}</span> 的本地账号配置和缓存邮件。
        </p>
        <p>这个操作不会删除远端邮箱中的邮件。</p>
        {error ? <FieldError>{error}</FieldError> : null}
      </div>
    </ResponsiveDialog>
  )
}
