const ENCODED_WORD_PATTERN = /=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi
const ADJACENT_ENCODED_WORD_PATTERN =
  /(=\?[^?]+\?[BQ]\?[^?]*\?=)\s+(?==\?[^?]+\?[BQ]\?)/gi
const PERCENT_ENCODED_CHUNK_PATTERN =
  /(?:%[0-9A-Fa-f]{2}|[A-Za-z0-9_.~!$&'()*+,;=:@/-])+/g
const LOOSE_QUOTED_PRINTABLE_CHUNK_PATTERN =
  /(?:=[0-9A-Fa-f]{2}|[A-Za-z0-9_.~!$&'()*+,;:@/? -])+/g
const HIGH_BYTE_PERCENT_PATTERN = /%(?:[89A-Fa-f][0-9A-Fa-f])/
const HIGH_BYTE_QUOTED_PRINTABLE_PATTERN = /=(?:[89A-Fa-f][0-9A-Fa-f])/

export function normalizeMailDisplayText(value?: string): string | undefined {
  const decoded = decodeMailText(value, true).replace(/\s+/g, ' ').trim()
  return decoded || undefined
}

export function normalizeMailBodyText(value?: string): string | undefined {
  const decoded = decodeMailText(value, false).replace(/\r\n/g, '\n').trim()
  return decoded || undefined
}

export function decodeMimeWords(value?: string): string {
  if (!value) return ''

  const unfolded = value.replace(/\r?\n[\t ]+/g, ' ')
  const compact = unfolded.replace(ADJACENT_ENCODED_WORD_PATTERN, '$1')

  return compact.replace(ENCODED_WORD_PATTERN, (_match, charset, encoding, text) => {
    try {
      const bytes =
        String(encoding).toUpperCase() === 'B'
          ? decodeBase64Bytes(String(text))
          : decodeQuotedPrintableBytes(String(text), true)

      return decodeBytes(bytes, String(charset))
    } catch {
      return String(text)
    }
  })
}

function decodeMailText(value: string | undefined, underscoreAsSpace: boolean): string {
  if (!value) return ''

  const decodedMimeWords = decodeMimeWords(value)
  const repairedMimeFragments = underscoreAsSpace
    ? stripBrokenMimeWordMarkers(decodedMimeWords)
    : decodedMimeWords

  return decodeLooseQuotedPrintableText(
    decodePercentEncodedText(repairedMimeFragments),
    underscoreAsSpace
  )
}

function decodePercentEncodedText(value: string): string {
  return value.replace(PERCENT_ENCODED_CHUNK_PATTERN, (chunk) => {
    if (!HIGH_BYTE_PERCENT_PATTERN.test(chunk)) return chunk

    try {
      return decodeURIComponent(chunk)
    } catch {
      return chunk
    }
  })
}

function decodeLooseQuotedPrintableText(value: string, underscoreAsSpace: boolean): string {
  return value.replace(LOOSE_QUOTED_PRINTABLE_CHUNK_PATTERN, (chunk) => {
    if (!HIGH_BYTE_QUOTED_PRINTABLE_PATTERN.test(chunk)) return chunk

    try {
      return decodeBytes(decodeQuotedPrintableBytes(chunk, underscoreAsSpace), 'utf-8')
    } catch {
      return chunk
    }
  })
}

function stripBrokenMimeWordMarkers(value: string): string {
  return value
    .replace(/=\?[^?]+\?[BQ]\?/gi, ' ')
    .replace(/\?=/g, ' ')
    .replace(/=_/g, ' ')
}

function decodeQuotedPrintableBytes(value: string, underscoreAsSpace: boolean): Uint8Array {
  const bytes: number[] = []

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    const hex = value.slice(index + 1, index + 3)

    if (char === '=' && /^[0-9A-Fa-f]{2}$/.test(hex)) {
      bytes.push(Number.parseInt(hex, 16))
      index += 2
      continue
    }

    if (underscoreAsSpace && char === '_') {
      bytes.push(0x20)
      continue
    }

    bytes.push(char.charCodeAt(0) & 0xff)
  }

  return new Uint8Array(bytes)
}

function decodeBase64Bytes(value: string): Uint8Array {
  const cleanValue = value.replace(/\s+/g, '')
  const bytes: number[] = []
  let buffer = 0
  let bitCount = 0

  for (const char of cleanValue) {
    if (char === '=') break

    const digit = base64Digit(char)
    if (digit < 0) continue

    buffer = (buffer << 6) | digit
    bitCount += 6

    if (bitCount >= 8) {
      bitCount -= 8
      bytes.push((buffer >> bitCount) & 0xff)
    }
  }

  return new Uint8Array(bytes)
}

function base64Digit(char: string): number {
  const code = char.charCodeAt(0)
  if (code >= 65 && code <= 90) return code - 65
  if (code >= 97 && code <= 122) return code - 71
  if (code >= 48 && code <= 57) return code + 4
  if (char === '+') return 62
  if (char === '/') return 63
  return -1
}

function decodeBytes(bytes: Uint8Array, charset: string): string {
  for (const label of getCharsetLabels(charset)) {
    try {
      return new TextDecoder(label).decode(bytes)
    } catch {
      continue
    }
  }

  return String.fromCharCode(...bytes)
}

function getCharsetLabels(charset: string): string[] {
  const normalized = charset.trim().replace(/^"|"$/g, '').toLowerCase()

  if (normalized === 'utf8' || normalized === 'utf-8') return ['utf-8']
  if (['gb18030', 'gbk', 'gb2312', 'cp936'].includes(normalized)) {
    return ['gb18030', 'gbk', 'utf-8']
  }
  if (['big5', 'big-5'].includes(normalized)) return ['big5', 'utf-8']
  if (['latin1', 'latin-1', 'iso-8859-1'].includes(normalized)) {
    return ['windows-1252', 'iso-8859-1', 'utf-8']
  }

  return [normalized, 'utf-8', 'windows-1252']
}
