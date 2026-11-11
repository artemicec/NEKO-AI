// src/shared/services/markdown.ts
// Единый безопасный рендер Markdown → HTML (чат и дневник). Модель — недоверенный источник:
// всё проходит через DOMPurify, картинки/формы вырезаются (удалённая картинка = утечка IP), ссылки — в системный браузер.

import { marked } from 'marked'
import DOMPurify from 'dompurify'

let hooked = false
function ensureHook() {
  if (hooked) return
  hooked = true
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank')
      node.setAttribute('rel', 'noopener noreferrer')
    }
  })
}

export function renderMarkdown(src: string): string {
  if (!src) return ''
  ensureHook()
  const html = marked.parse(src, { async: false, gfm: true, breaks: true }) as string
  return DOMPurify.sanitize(html, { FORBID_TAGS: ['style', 'img', 'form', 'input', 'button', 'iframe'] })
}
