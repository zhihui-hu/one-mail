import { resolve } from 'path'
import { defineConfig, loadEnv } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ['ONEMAIL_'])
  const microsoftClientId = env.ONEMAIL_MICROSOFT_CLIENT_ID?.trim()

  return {
    main: {
      define: microsoftClientId
        ? {
            'process.env.ONEMAIL_MICROSOFT_CLIENT_ID': JSON.stringify(microsoftClientId)
          }
        : undefined
    },
    preload: {},
    renderer: {
      server: {
        port: 27508,
        strictPort: true
      },
      resolve: {
        alias: {
          '@renderer': resolve('src/renderer/src')
        }
      },
      plugins: [react(), tailwindcss()]
    }
  }
})
