import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

document.documentElement.dataset.platform = window.electron?.process?.platform ?? 'browser'

const savedTheme = window.localStorage.getItem('theme')
const initialTheme = savedTheme === 'light' || savedTheme === 'dark' ? savedTheme : 'light'
document.documentElement.classList.add(initialTheme)
document.documentElement.style.colorScheme = initialTheme
void window.api?.system?.setTitleBarTheme?.(initialTheme)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
