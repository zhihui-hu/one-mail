import { RouterProvider } from 'react-router/dom'

import { appRouter } from './app/router'
import { Toaster } from './components/ui/sonner'

function App(): React.JSX.Element {
  return (
    <>
      <RouterProvider router={appRouter} />
      <Toaster richColors />
    </>
  )
}

export default App
