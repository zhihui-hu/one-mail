/// <reference types="vite/client" />

import type { OneMailApi } from './shared/types'

interface ImportMetaEnv {
  readonly VITE_APP_ENV: 'dev' | 'prod' | 'stage'
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare global {
  const __APP_BUILD_TIME__: string

  interface Window {
    api: OneMailApi
  }
}

export {}
