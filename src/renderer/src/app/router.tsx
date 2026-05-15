import { createHashRouter, Navigate } from 'react-router'

import { AddAccountPage } from '@renderer/pages/add-account-page'
import { MailboxPage } from '@renderer/pages/mailbox-page'

export const appRouter = createHashRouter([
  {
    path: '/',
    element: <MailboxPage />
  },
  {
    path: '/accounts/new',
    element: <AddAccountPage />
  },
  {
    path: '/:accountId/:messageId',
    element: <MailboxPage />
  },
  {
    path: '*',
    element: <Navigate to="/" replace />
  }
])
