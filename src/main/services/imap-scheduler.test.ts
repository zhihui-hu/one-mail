import { describe, expect, it } from 'vitest'

import { scheduleImapTask } from './imap-scheduler'

describe('scheduleImapTask', () => {
  it('rejects queued tasks that throw synchronously when a host slot frees', async () => {
    const host = 'queued-sync-throw.example.com'
    const error = new Error('邮箱监听已停止。')
    let releaseFirstTask!: () => void

    const firstTask = scheduleImapTask(
      host,
      1,
      () =>
        new Promise<string>((resolve) => {
          releaseFirstTask = () => resolve('first')
        })
    )
    const stoppedTask = scheduleImapTask(host, 1, () => {
      throw error
    })

    await Promise.resolve()
    releaseFirstTask()

    await expect(firstTask).resolves.toBe('first')
    await expect(stoppedTask).rejects.toBe(error)
    await expect(scheduleImapTask(host, 1, () => Promise.resolve('after'))).resolves.toBe('after')
  })
})
