type ScheduledTask<T> = {
  host: string
  priority: number
  sequence: number
  run: () => Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

const MAX_PARALLEL_IMAP_TASKS = 3
const MAX_PARALLEL_PER_HOST = 1

const pendingTasks: Array<ScheduledTask<unknown>> = []
const runningByHost = new Map<string, number>()
let runningCount = 0
let sequence = 0

export function scheduleImapTask<T>(
  host: string,
  priority: number,
  run: () => Promise<T>
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    pendingTasks.push({
      host: normalizeHost(host),
      priority,
      sequence: sequence++,
      run,
      resolve: resolve as (value: unknown) => void,
      reject
    })
    drainQueue()
  })
}

function drainQueue(): void {
  while (runningCount < MAX_PARALLEL_IMAP_TASKS) {
    const nextIndex = findNextRunnableTaskIndex()
    if (nextIndex < 0) return

    const [task] = pendingTasks.splice(nextIndex, 1)
    startTask(task)
  }
}

function findNextRunnableTaskIndex(): number {
  return pendingTasks.reduce((bestIndex, task, index) => {
    if ((runningByHost.get(task.host) ?? 0) >= MAX_PARALLEL_PER_HOST) return bestIndex
    if (bestIndex < 0) return index

    const bestTask = pendingTasks[bestIndex]
    if (task.priority !== bestTask.priority) {
      return task.priority > bestTask.priority ? index : bestIndex
    }

    return task.sequence < bestTask.sequence ? index : bestIndex
  }, -1)
}

function startTask(task: ScheduledTask<unknown>): void {
  runningCount += 1
  runningByHost.set(task.host, (runningByHost.get(task.host) ?? 0) + 1)

  void Promise.resolve()
    .then(() => task.run())
    .then(task.resolve, task.reject)
    .finally(() => {
      runningCount -= 1
      const hostRunningCount = (runningByHost.get(task.host) ?? 1) - 1
      if (hostRunningCount <= 0) {
        runningByHost.delete(task.host)
      } else {
        runningByHost.set(task.host, hostRunningCount)
      }
      drainQueue()
    })
}

function normalizeHost(host: string): string {
  return host.trim().toLowerCase() || 'unknown'
}
