import { AppShell } from './components/layout/app-shell'
import { Toaster } from './components/ui/sonner'

function App(): React.JSX.Element {
  return (
    <>
      <AppShell />
      <Toaster richColors />
    </>
  )
}

export default App
