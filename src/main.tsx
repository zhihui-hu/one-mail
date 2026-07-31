import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App'
import { createDesktopApi } from './lib/desktop-api'

window.api = createDesktopApi()

document.documentElement.dataset.platform = getPlatform()

const savedTheme = window.localStorage.getItem('theme')
const initialTheme = savedTheme === 'light' || savedTheme === 'dark' ? savedTheme : 'light'
document.documentElement.classList.add(initialTheme)
document.documentElement.style.colorScheme = initialTheme
void window.api.system
  .setTitleBarTheme(initialTheme)
  .catch((error) => console.warn('Failed to update the title bar theme.', error))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)

function getPlatform(): 'macos' | 'windows' | 'linux' {
  const platform = navigator.platform.toLowerCase()
  if (platform.includes('mac')) return 'macos'
  if (platform.includes('win')) return 'windows'
  return 'linux'
}
