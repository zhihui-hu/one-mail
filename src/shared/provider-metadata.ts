export type NormalizedProviderKey =
  | 'gmail'
  | 'yahoo'
  | 'outlook'
  | '163'
  | 'qq'
  | 'qqEnterprise'
  | 'aliyun'
  | 'aliyunEnterprise'
  | '189'
  | 'sohu'
  | 'sina'
  | '139'
  | '21cn'
  | 'perfect'
  | 'icloud'
  | 'aol'
  | 'yandex'
  | 'mailru'
  | 'custom'
  | 'manual'
  | string

export type ProviderLogoMetadata = {
  domain: string
  fallback: string
}

const PROVIDER_LOGO_METADATA: Record<string, ProviderLogoMetadata> = {
  gmail: { domain: 'gmail.com', fallback: 'G' },
  yahoo: { domain: 'yahoo.com', fallback: 'Y' },
  outlook: { domain: 'outlook.com', fallback: 'O' },
  '163': { domain: '163.com', fallback: '易' },
  qq: { domain: 'qq.com', fallback: 'Q' },
  qqEnterprise: { domain: 'exmail.qq.com', fallback: '企' },
  aliyun: { domain: 'aliyun.com', fallback: '阿' },
  aliyunEnterprise: { domain: 'qiye.aliyun.com', fallback: '企' },
  '189': { domain: '189.cn', fallback: '天' },
  sohu: { domain: 'sohu.com', fallback: '狐' },
  sina: { domain: 'sina.com', fallback: '新' },
  '139': { domain: '139.com', fallback: '移' },
  '21cn': { domain: '21cn.com', fallback: '21' },
  perfect: { domain: '88.com', fallback: '88' },
  icloud: { domain: 'icloud.com', fallback: 'i' },
  aol: { domain: 'aol.com', fallback: 'A' },
  yandex: { domain: 'yandex.com', fallback: 'Y' },
  mailru: { domain: 'mail.ru', fallback: 'M' }
}

export function normalizeProviderKey(providerKey?: string): NormalizedProviderKey {
  if (!providerKey) return 'custom'

  const normalized = providerKey.trim().toLowerCase()
  if (!normalized) return 'custom'
  if (normalized.includes('gmail') || normalized.includes('google')) return 'gmail'
  if (normalized.includes('yahoo')) return 'yahoo'
  if (
    normalized.includes('outlook') ||
    normalized.includes('hotmail') ||
    normalized.includes('live.com') ||
    normalized.includes('office365') ||
    normalized.includes('microsoft')
  ) {
    return 'outlook'
  }
  if (
    normalized.includes('163') ||
    normalized.includes('126') ||
    normalized.includes('yeah') ||
    normalized.includes('netease')
  ) {
    return '163'
  }
  if (normalized.includes('qq_enterprise') || normalized.includes('exmail')) return 'qqEnterprise'
  if (normalized.includes('qq') || normalized.includes('foxmail')) return 'qq'
  if (
    normalized.includes('aliyun_enterprise') ||
    normalized.includes('alibaba') ||
    normalized.includes('qiye.aliyun')
  ) {
    return 'aliyunEnterprise'
  }
  if (normalized.includes('aliyun')) return 'aliyun'
  if (normalized.includes('189')) return '189'
  if (normalized.includes('sohu')) return 'sohu'
  if (normalized.includes('sina')) return 'sina'
  if (normalized.includes('139')) return '139'
  if (normalized.includes('21cn')) return '21cn'
  if (
    normalized.includes('perfect') ||
    normalized.includes('88.com') ||
    normalized.includes('111.com') ||
    normalized.includes('email.cn')
  ) {
    return 'perfect'
  }
  if (
    normalized.includes('icloud') ||
    normalized.includes('me.com') ||
    normalized.includes('mac.com')
  ) {
    return 'icloud'
  }
  if (normalized.includes('aol')) return 'aol'
  if (normalized.includes('yandex')) return 'yandex'
  if (normalized.includes('mailru') || normalized.includes('mail.ru')) return 'mailru'
  if (normalized.includes('custom')) return 'custom'
  if (normalized.includes('manual')) return 'manual'

  return normalized
}

export function getProviderLogoMetadata(providerKey?: string, address?: string): ProviderLogoMetadata {
  const normalizedProviderKey = normalizeProviderKey(providerKey)
  const metadata = PROVIDER_LOGO_METADATA[normalizedProviderKey]
  if (metadata) return metadata

  const domain = getEmailDomain(address)
  return {
    domain,
    fallback: getFallbackLabel(domain || providerKey || address || 'mail')
  }
}

export function getEmailDomain(address?: string): string {
  return address?.split('@')[1]?.trim().toLowerCase() || ''
}

function getFallbackLabel(value: string): string {
  const compact = value.trim()
  if (!compact) return 'M'

  const first = compact.replace(/^www\./, '').charAt(0)
  return first ? first.toUpperCase() : 'M'
}
