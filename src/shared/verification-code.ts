const VERIFICATION_KEYWORD_SOURCE =
  '验证码|校验码|验证(?:码|代码)|安全(?:码|代码)|动态码|一次性(?:代码|密码|验证码)|单次(?:使用)?代码|登录(?:码|代码)|确认(?:码|代码)|身份验证|verification\\s*code|security\\s*code|one[-\\s]?time\\s*(?:code|password)|single[-\\s]?use\\s*code|authentication\\s*code|login\\s*code|confirmation\\s*code|passcode|\\botp\\b|\\bpin\\b|\\b2fa\\b|\\bmfa\\b'

const VERIFICATION_KEYWORD_PATTERN = new RegExp(VERIFICATION_KEYWORD_SOURCE, 'i')
const CODE_TOKEN_SOURCE = '(?:^|[^A-Z0-9])([A-Z0-9](?:[\\s-]?[A-Z0-9]){3,9})(?=$|[^A-Z0-9])'
const CONTEXTUAL_CODE_PATTERNS = [
  new RegExp(`(?:${VERIFICATION_KEYWORD_SOURCE})[\\s\\S]{0,80}?${CODE_TOKEN_SOURCE}`, 'i'),
  new RegExp(`${CODE_TOKEN_SOURCE}[\\s\\S]{0,32}?(?:${VERIFICATION_KEYWORD_SOURCE})`, 'i')
]
const GENERIC_CODE_PATTERN =
  /(?:^|[^A-Z0-9])(\d(?:[\s-]?\d){3,7}|[A-Z]{1,3}[\s-]?\d(?:[\s-]?[A-Z0-9]){2,7}|\d[\s-]?[A-Z](?:[\s-]?[A-Z0-9]){2,7})(?=$|[^A-Z0-9])/gi

export function isVerificationMailCandidate(...parts: Array<string | null | undefined>): boolean {
  return VERIFICATION_KEYWORD_PATTERN.test(normalizeVerificationText(parts))
}

export function extractVerificationCode(
  ...parts: Array<string | null | undefined>
): string | undefined {
  const text = normalizeVerificationText(parts)
  if (!VERIFICATION_KEYWORD_PATTERN.test(text)) return undefined

  for (const pattern of CONTEXTUAL_CODE_PATTERNS) {
    const match = pattern.exec(text)
    const code = normalizeCodeCandidate(match?.[1])
    if (code) return code
  }

  for (const match of text.matchAll(GENERIC_CODE_PATTERN)) {
    const code = normalizeCodeCandidate(match[1], { rejectYearLikeCodes: true })
    if (code) return code
  }

  return undefined
}

function normalizeVerificationText(parts: Array<string | null | undefined>): string {
  return parts
    .filter((part): part is string => Boolean(part))
    .map((part) => decodeBasicHtmlEntities(stripHtmlTags(normalizeFullWidthText(part))))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeFullWidthText(value: string): string {
  return value.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0xfee0)
  )
}

function stripHtmlTags(value: string): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
}

function decodeBasicHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/&#(\d+);/g, (_match, codePoint: string) => {
      const value = Number(codePoint)
      return Number.isInteger(value) ? String.fromCodePoint(value) : ' '
    })
}

function normalizeCodeCandidate(
  value?: string,
  options: { rejectYearLikeCodes?: boolean } = {}
): string | undefined {
  const code = value?.replace(/[\s-]/g, '').toUpperCase()
  if (!code || !/^[A-Z0-9]{4,10}$/.test(code)) return undefined
  if (!/\d/.test(code)) return undefined
  if (options.rejectYearLikeCodes && /^(19|20)\d{2}$/.test(code)) return undefined
  return code
}
