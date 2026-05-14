import * as React from 'react'
import { toast } from 'sonner'

import { AddAccountForm } from '@renderer/components/account/add-account-dialog'
import { createAccount } from '@renderer/lib/api'
import type { AccountCreateInput } from '../../../../shared/types'

export function AddAccountWindow(): React.JSX.Element {
  async function handleSubmit(input: AccountCreateInput): Promise<void> {
    const account = await createAccount(input)
    toast.success(`${account.email} 已保存，正在主窗口后台同步...`)
    window.setTimeout(() => {
      void window.api.accounts.closeAddWindow()
    }, 450)
  }

  return (
    <main className="flex h-screen min-h-screen flex-col overflow-hidden bg-background text-foreground">
      <header className="app-drag-region flex h-10 shrink-0 items-center border-b bg-card/60 px-5 pl-24">
        <h1 className="truncate text-sm font-semibold tracking-normal">添加账号</h1>
      </header>
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
        <AddAccountForm
          onSubmit={handleSubmit}
          className="flex min-h-0 flex-1 flex-col gap-3"
          bodyClassName="flex min-h-0 flex-col gap-3 overflow-auto"
          footerClassName="mt-1 flex shrink-0 justify-end"
        />
      </section>
    </main>
  )
}
