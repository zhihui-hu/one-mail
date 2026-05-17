import { RouterProvider } from 'react-router/dom'

import { appRouter } from './app/router'
import { I18nProvider } from './lib/i18n'
import { Toaster } from './components/ui/sonner'

function App(): React.JSX.Element {
  return (
    <I18nProvider>
      <RouterProvider router={appRouter} />
      <Toaster richColors />
    </I18nProvider>
  )
}

export default App
