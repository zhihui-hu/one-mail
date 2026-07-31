import { QueryClientProvider } from '@tanstack/react-query'
import { Provider as JotaiProvider } from 'jotai'
import { Suspense } from 'react'
import { RouterProvider } from 'react-router/dom'

import { appRouter } from './app/router'
import BuildInfo from './components/build-info'
import { SweepShine } from './components/sweep-shine'
import { Toaster } from './components/ui/sonner'
import { I18nProvider } from './lib/i18n'
import { queryClient } from './lib/query-client'

function App(): React.JSX.Element {
  return (
    <JotaiProvider>
      <QueryClientProvider client={queryClient}>
        <I18nProvider>
          <Suspense
            fallback={
              <div className="grid min-h-screen place-items-center">
                <SweepShine>OneMail</SweepShine>
              </div>
            }
          >
            <RouterProvider router={appRouter} />
          </Suspense>
          <Toaster richColors />
          <BuildInfo />
        </I18nProvider>
      </QueryClientProvider>
    </JotaiProvider>
  )
}

export default App
