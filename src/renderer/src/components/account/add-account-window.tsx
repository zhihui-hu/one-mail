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
      <section className="min-h-0 flex-1 overflow-auto p-4">
        <AddAccountForm
          onSubmit={handleSubmit}
          onCancel={() => {
            void window.api.accounts.closeAddWindow()
          }}
          className="flex flex-col gap-3"
          bodyClassName="flex flex-col gap-3"
          footerClassName="mt-1 flex flex-col-reverse gap-2"
        />
      </section>
    </main>
  )
}
