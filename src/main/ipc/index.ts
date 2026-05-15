import { registerAccountIpc } from './accounts'
import { registerComposeIpc } from './compose'
import { registerLogoIpc } from './logos'
import { registerMessageActionIpc } from './message-actions'
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
  registerComposeIpc()
  registerLogoIpc()
  registerMessageIpc()
  registerMessageActionIpc()
  registerNotificationIpc()
  registerSyncIpc()
  registerSettingsIpc()
  registerSystemIpc()

  registered = true
}
