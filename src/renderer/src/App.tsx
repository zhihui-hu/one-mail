import { AddAccountWindow } from './components/account/add-account-window'
import { AppShell } from './components/layout/app-shell'
import { Toaster } from './components/ui/sonner'

function App(): React.JSX.Element {
  const windowKind = new URLSearchParams(window.location.search).get('window')

  return (
    <>
      {windowKind === 'add-account' ? <AddAccountWindow /> : <AppShell />}
      <Toaster richColors />
    </>
  )
}

export default App
