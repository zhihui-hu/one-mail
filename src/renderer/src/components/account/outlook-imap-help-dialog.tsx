import * as React from 'react'

import { ResponsiveDialog } from '@renderer/components/responsive-dialog'
import { Button } from '@renderer/components/ui/button'
import { useI18n } from '@renderer/lib/i18n'

type OutlookImapHelpDialogProps = {
  accountLabel?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function OutlookImapHelpDialog({
  accountLabel,
  open,
  onOpenChange
}: OutlookImapHelpDialogProps): React.JSX.Element {
  const { t } = useI18n()

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('account.outlookImapHelp.title')}
      description={
        accountLabel
          ? t('account.outlookImapHelp.descriptionWithAccount', { account: accountLabel })
          : t('account.outlookImapHelp.description')
      }
      contentClassName="gap-4 p-5 sm:max-w-md"
      bodyClassName="text-sm"
      footer={
        <Button type="button" onClick={() => onOpenChange(false)}>
          {t('common.ok')}
        </Button>
      }
    >
      <ol className="flex list-decimal flex-col gap-2 pl-5 text-foreground">
        <li>{t('account.outlookImapHelp.step1')}</li>
        <li>{t('account.outlookImapHelp.step2')}</li>
        <li>{t('account.outlookImapHelp.step3')}</li>
        <li>{t('account.outlookImapHelp.step4')}</li>
      </ol>
    </ResponsiveDialog>
  )
}
