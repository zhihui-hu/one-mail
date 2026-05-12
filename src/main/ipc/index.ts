import { registerAccountIpc } from './accounts'
import { registerLogoIpc } from './logos'
import { registerMessageIpc } from './messages'
import { registerNotificationIpc } from './notifications'
import { registerSettingsIpc } from './settings'
import { registerSyncIpc } from './sync'
import { registerSystemIpc } from './system'

let registered = false

export function registerIpcHandlers(): void {
  if (registered) {
    return
  }

  registerAccountIpc()
  registerLogoIpc()
  registerMessageIpc()
  registerNotificationIpc()
  registerSyncIpc()
  registerSettingsIpc()
  registerSystemIpc()

  registered = true
}
