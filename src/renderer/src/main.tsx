import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

const savedTheme = window.localStorage.getItem('theme')
const initialTheme = savedTheme === 'light' || savedTheme === 'dark' ? savedTheme : 'dark'
document.documentElement.classList.add(initialTheme)
document.documentElement.style.colorScheme = initialTheme

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
