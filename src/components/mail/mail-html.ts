export type PreparedMailHtml = {
  html: string
  blockedResourceCount: number
  blockedImageResourceCount: number
  removedUnsafeElementCount: number
}

type PrepareMailHtmlOptions = {
  allowExternalImages: boolean
}

const removedElementSelector = [
  'script',
  'noscript',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'base',
  'meta',
  'link',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'option',
  'svg',
  'math'
].join(',')

const resourceAttributes = ['src', 'srcset', 'poster', 'background'] as const
const blockedResourceOnlyContainerSelector = [
  'a',
  'span',
  'p',
  'div',
  'center',
  'section',
  'article',
  'td',
  'th',
  'tr',
  'tbody',
  'thead',
  'tfoot',
  'table'
].join(',')
const layoutBreakingStyleProperties = new Set([
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'inset',
  'inset-block',
  'inset-block-start',
  'inset-block-end',
  'inset-inline',
  'inset-inline-start',
  'inset-inline-end',
  'z-index',
  'float',
  'transform',
  'translate',
  'scale',
  'rotate',
  'filter',
  'backdrop-filter',
  'clip',
  'clip-path'
])

export function prepareMailHtml(
  html: string,
  { allowExternalImages }: PrepareMailHtmlOptions
): PreparedMailHtml {
  const document = new DOMParser().parseFromString(html, 'text/html')
  const counters = {
    blockedResourceCount: 0,
    blockedImageResourceCount: 0,
    removedUnsafeElementCount: 0
  }

  for (const element of Array.from(document.body.querySelectorAll(removedElementSelector))) {
    counters.removedUnsafeElementCount += 1
    element.remove()
  }

  for (const element of Array.from(document.body.querySelectorAll('*'))) {
    sanitizeAttributes(element, allowExternalImages, counters)
  }

  if (!allowExternalImages) {
    markBlockedResourceOnlyContainers(document.body)
  } else {
    for (const element of Array.from(document.body.querySelectorAll('[data-mail-blocked-only]'))) {
      element.removeAttribute('data-mail-blocked-only')
    }
  }

  return {
    html: document.body.innerHTML,
    ...counters
  }
}

function sanitizeAttributes(
  element: Element,
  allowExternalImages: boolean,
  counters: {
    blockedResourceCount: number
    blockedImageResourceCount: number
  }
): void {
  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.name.toLowerCase()

    if (name.startsWith('on') || name === 'srcdoc' || name === 'ping') {
      element.removeAttribute(attribute.name)
      continue
    }

    if ((name === 'href' || name.endsWith(':href')) && !isSafeHref(attribute.value)) {
      element.removeAttribute(attribute.name)
    }
  }

  for (const attribute of resourceAttributes) {
    sanitizeResourceAttribute(element, attribute, allowExternalImages, counters)
  }

  sanitizeStyleAttribute(element, allowExternalImages, counters)
  hardenLinks(element)
}

function sanitizeResourceAttribute(
  element: Element,
  attribute: (typeof resourceAttributes)[number],
  allowExternalImages: boolean,
  counters: {
    blockedResourceCount: number
    blockedImageResourceCount: number
  }
): void {
  const blockedAttribute = toBlockedAttribute(attribute)
  const blockedValue = element.getAttribute(blockedAttribute)

  if (
    blockedValue &&
    allowExternalImages &&
    canRestoreImageResource(element, attribute) &&
    isSafeResourceValue(attribute, normalizeRestoredResourceValue(attribute, blockedValue))
  ) {
    element.setAttribute(attribute, normalizeRestoredResourceValue(attribute, blockedValue))
    element.removeAttribute(blockedAttribute)
    element.removeAttribute('data-mail-blocked-resource')
    hardenImageElement(element)
    return
  }

  const value = element.getAttribute(attribute)
  const shouldBlock =
    Boolean(value) &&
    (!allowExternalImages ||
      !canRestoreImageResource(element, attribute) ||
      !isSafeResourceValue(attribute, value ?? ''))

  if (shouldBlock) {
    rememberBlockedResource(element, attribute, counters)
    return
  }

  if (blockedValue) {
    counters.blockedResourceCount += 1
    if (canRestoreImageResource(element, attribute)) {
      counters.blockedImageResourceCount += 1
    }
    markBlockedResource(element, attribute)
  }

  if (value) hardenImageElement(element)
}

function sanitizeStyleAttribute(
  element: Element,
  allowExternalImages: boolean,
  counters: {
    blockedResourceCount: number
    blockedImageResourceCount: number
  }
): void {
  const blockedStyle = element.getAttribute('data-blocked-style')
  const inlineStyle = element.getAttribute('style')
  const style = inlineStyle ?? (allowExternalImages ? blockedStyle : null)

  if (!style) {
    if (blockedStyle) {
      counters.blockedResourceCount += 1
      counters.blockedImageResourceCount += 1
      element.setAttribute('data-mail-blocked-resource', 'true')
    }
    return
  }

  if (!isSafeStyle(style)) {
    element.removeAttribute('style')
    element.removeAttribute('data-blocked-style')
    element.removeAttribute('data-mail-blocked-resource')
    return
  }

  const sanitized = sanitizeStyleDeclarations(element, style, allowExternalImages)

  if (sanitized.blockedResource) {
    element.setAttribute('data-blocked-style', style)
    element.removeAttribute('style')
    element.setAttribute('data-mail-blocked-resource', 'true')
    counters.blockedResourceCount += 1
    counters.blockedImageResourceCount += 1
    return
  }

  if (sanitized.style) {
    element.setAttribute('style', sanitized.style)
  } else {
    element.removeAttribute('style')
  }

  if (allowExternalImages) {
    element.removeAttribute('data-blocked-style')
    element.removeAttribute('data-mail-blocked-resource')
  }
}

function sanitizeStyleDeclarations(
  element: Element,
  value: string,
  allowExternalImages: boolean
): { style: string; blockedResource: boolean } {
  const scratch = element.ownerDocument.createElement('span')
  scratch.setAttribute('style', value)

  const declarations: string[] = []
  let blockedResource = false

  for (const property of Array.from({ length: scratch.style.length }, (_, index) =>
    scratch.style.item(index)
  )) {
    const name = property.toLowerCase()
    const propertyValue = scratch.style.getPropertyValue(property).trim()

    if (!propertyValue || shouldDropStyleProperty(name, propertyValue)) continue

    if (styleLoadsResource(`${name}: ${propertyValue}`)) {
      if (!allowExternalImages) {
        blockedResource = true
        continue
      }

      if (!styleResourceUrlsAreSafe(propertyValue)) continue
    }

    declarations.push(`${name}: ${propertyValue}`)
  }

  return {
    style: declarations.join('; '),
    blockedResource
  }
}

function shouldDropStyleProperty(name: string, value: string): boolean {
  if (layoutBreakingStyleProperties.has(name)) return true
  if (name.startsWith('animation') || name.startsWith('transition')) return true
  if ((name === 'margin' || name.startsWith('margin-')) && hasNegativeCssLength(value)) return true
  if ((name === 'text-indent' || name === 'letter-spacing') && hasNegativeCssLength(value)) {
    return true
  }
  if (name === 'line-height' && isCollapsedLineHeight(value)) return true
  return false
}

function hasNegativeCssLength(value: string): boolean {
  return /(^|[\s(])-((?:\d*\.)?\d+)(px|pt|em|rem|%|vh|vw|vmin|vmax|cm|mm|in|pc|ch|ex|lh|rlh)\b/i.test(
    value
  )
}

function isCollapsedLineHeight(value: string): boolean {
  return /^0(?:\.0+)?(?:px|pt|em|rem|%|vh|vw|vmin|vmax|cm|mm|in|pc|ch|ex|lh|rlh)?$/i.test(
    value.trim()
  )
}

function styleResourceUrlsAreSafe(value: string): boolean {
  return Array.from(value.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)).every((match) =>
    isSafeResourceUrl(match[2] ?? '')
  )
}

function markBlockedResourceOnlyContainers(root: HTMLElement): void {
  const candidates = Array.from(
    root.querySelectorAll(blockedResourceOnlyContainerSelector)
  ).reverse()

  for (const element of candidates) {
    if (isBlockedResourceOnlyElement(element)) {
      element.setAttribute('data-mail-blocked-only', 'true')
    }
  }
}

function isBlockedResourceOnlyElement(element: Element): boolean {
  let hasBlockedResource = false

  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      if (child.textContent?.trim()) return false
      continue
    }

    if (child.nodeType !== Node.ELEMENT_NODE) continue

    const childElement = child as Element

    if (isBlockedResourcePlaceholder(childElement)) {
      hasBlockedResource = true
      continue
    }

    if (childElement.getAttribute('data-mail-blocked-only') === 'true') {
      hasBlockedResource = true
      continue
    }

    if (isEmptyLayoutElement(childElement)) continue

    return false
  }

  return hasBlockedResource
}

function isBlockedResourcePlaceholder(element: Element): boolean {
  return (
    element.getAttribute('data-mail-blocked-resource') === 'true' &&
    !element.getAttribute('src') &&
    !element.getAttribute('srcset')
  )
}

function isEmptyLayoutElement(element: Element): boolean {
  return !element.textContent?.trim() && element.children.length === 0
}

function rememberBlockedResource(
  element: Element,
  attribute: (typeof resourceAttributes)[number],
  counters: {
    blockedResourceCount: number
    blockedImageResourceCount: number
  }
): void {
  const blockedAttribute = toBlockedAttribute(attribute)
  const value = element.getAttribute(attribute)

  if (value && !element.hasAttribute(blockedAttribute)) {
    element.setAttribute(blockedAttribute, value)
  }

  element.removeAttribute(attribute)
  counters.blockedResourceCount += 1

  if (canRestoreImageResource(element, attribute)) {
    counters.blockedImageResourceCount += 1
    markBlockedResource(element, attribute)
  }
}

function markBlockedResource(
  element: Element,
  attribute: (typeof resourceAttributes)[number]
): void {
  if (canRestoreImageResource(element, attribute)) {
    element.setAttribute('data-mail-blocked-resource', 'true')
  }
}

function canRestoreImageResource(
  element: Element,
  attribute: (typeof resourceAttributes)[number]
): boolean {
  const tagName = element.tagName.toLowerCase()

  if (attribute === 'background') return true
  if (tagName === 'img' && (attribute === 'src' || attribute === 'srcset')) return true
  if (tagName === 'source' && attribute === 'srcset') {
    return element.parentElement?.tagName.toLowerCase() === 'picture'
  }

  return false
}

function hardenImageElement(element: Element): void {
  if (element.tagName.toLowerCase() !== 'img') return

  element.setAttribute('loading', 'lazy')
  element.setAttribute('decoding', 'async')
  element.setAttribute('referrerpolicy', 'no-referrer')
}

function hardenLinks(element: Element): void {
  if (element.tagName.toLowerCase() !== 'a' || !element.getAttribute('href')) return

  element.setAttribute('target', '_blank')
  element.setAttribute('rel', 'noopener noreferrer nofollow')
}

function toBlockedAttribute(attribute: string): string {
  return `data-blocked-${attribute}`
}

function isSafeHref(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed || trimmed.startsWith('#')) return true
  if (/^(https?:|mailto:|tel:)/i.test(trimmed)) return true
  return !/^[a-z][a-z0-9+.-]*:/i.test(trimmed)
}

function isSafeResourceValue(
  attribute: (typeof resourceAttributes)[number],
  value: string
): boolean {
  if (attribute === 'srcset') return isSafeSrcset(value)
  return isSafeResourceUrl(value)
}

function normalizeRestoredResourceValue(
  attribute: (typeof resourceAttributes)[number],
  value: string
): string {
  if (attribute === 'srcset') return normalizeRestoredSrcset(value)
  return normalizeRestoredResourceUrl(value)
}

function normalizeRestoredSrcset(value: string): string {
  return value
    .split(',')
    .map((candidate) => {
      const parts = candidate.trim().split(/\s+/)
      const url = parts[0]
      if (!url) return ''
      return [normalizeRestoredResourceUrl(url), ...parts.slice(1)].join(' ')
    })
    .filter(Boolean)
    .join(', ')
}

function normalizeRestoredResourceUrl(value: string): string {
  const trimmed = value.trim()
  if (!looksLikeHostnameRelativeUrl(trimmed)) return value
  return `https://${trimmed}`
}

function looksLikeHostnameRelativeUrl(value: string): boolean {
  if (!value || value.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(value)) return false

  const firstSegment = value.split(/[/?#]/, 1)[0]
  return /^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d+)?$/i.test(firstSegment)
}

function isSafeSrcset(value: string): boolean {
  if (/^\s*data:/i.test(value)) return false

  return value
    .split(',')
    .map((candidate) => candidate.trim().split(/\s+/)[0])
    .filter(Boolean)
    .every(isSafeResourceUrl)
}

function isSafeResourceUrl(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (/^\/\//.test(trimmed)) return true
  if (/^https?:/i.test(trimmed)) return true
  if (/^cid:/i.test(trimmed)) return true
  if (/^data:image\/(avif|bmp|gif|jpeg|jpg|png|webp);base64,/i.test(trimmed)) return true
  return !/^[a-z][a-z0-9+.-]*:/i.test(trimmed)
}

function isSafeStyle(value: string): boolean {
  return !/(javascript\s*:|expression\s*\(|behavior\s*:|-moz-binding\s*:)/i.test(value)
}

function styleLoadsResource(value: string): boolean {
  return /(url\s*\(|@import)/i.test(value)
}
