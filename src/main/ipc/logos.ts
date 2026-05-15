import { ipcMain } from 'electron'

const LOGO_CACHE = new Map<string, string | null>()
const LOGO_TIMEOUT_MS = 5000

export function registerLogoIpc(): void {
  ipcMain.handle('logos/get', async (_event, domain: string) => getLogoDataUrl(domain))
}

export async function getLogoDataUrl(domain: string): Promise<string | null> {
  const normalizedDomain = normalizeDomain(domain)
  if (!normalizedDomain) return null

  if (LOGO_CACHE.has(normalizedDomain)) {
    return LOGO_CACHE.get(normalizedDomain) ?? null
  }

  try {
    const logo = await fetchLogo(normalizedDomain)
    LOGO_CACHE.set(normalizedDomain, logo)
    return logo
  } catch {
    LOGO_CACHE.set(normalizedDomain, null)
    return null
  }
}

async function fetchLogo(domain: string): Promise<string | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), LOGO_TIMEOUT_MS)

  try {
    const response = await fetch(
      `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`,
      { signal: controller.signal }
    )
    if (!response.ok) return null

    const contentType = response.headers.get('content-type') ?? 'image/png'
    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    if (buffer.length < 100) return null

    return `data:${contentType};base64,${buffer.toString('base64')}`
  } finally {
    clearTimeout(timeout)
  }
}

function normalizeDomain(domain: string): string {
  const text = domain.trim().toLowerCase()
  if (!text) return ''

  return text.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
}
