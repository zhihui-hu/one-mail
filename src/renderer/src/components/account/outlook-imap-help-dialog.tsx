import * as React from 'react'

import { ResponsiveDialog } from '@renderer/components/responsive-dialog'
import { Button } from '@renderer/components/ui/button'

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
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="需要为账号启用 IMAP 访问"
      description={
        accountLabel
          ? `${accountLabel} 的 Outlook IMAP 登录被服务器拒绝。账号已保存，完成下列设置后点击该邮箱右侧刷新。`
          : 'Outlook IMAP 登录被服务器拒绝。账号已保存，完成下列设置后点击该邮箱右侧刷新。'
      }
      contentClassName="gap-4 p-5 sm:max-w-md"
      bodyClassName="text-sm"
      footer={
        <Button type="button" onClick={() => onOpenChange(false)}>
          知道了
        </Button>
      }
    >
      <ol className="flex list-decimal flex-col gap-2 pl-5 text-foreground">
        <li>前往 Outlook.com 并登录。</li>
        <li>点击 设置 &gt; 邮件 &gt; 转发和 IMAP。</li>
        <li>登录并确保“允许设备和应用使用 IMAP”已开启。</li>
        <li>点击保存。</li>
      </ol>
    </ResponsiveDialog>
  )
}
