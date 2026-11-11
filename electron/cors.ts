// electron/cors.ts
// CORS-заплатка для страниц приложения. Облачные API (OpenAI, Anthropic, ElevenLabs…) не отдают заголовков CORS для
// страниц Electron, поэтому главный процесс подставляет их в ответы — но ТОЛЬКО для известных хостов:
// локальных сервисов (Ollama, Stable Diffusion, Chatterbox, Whisper), облачных провайдеров из списка ниже и адреса,
// который пользователь сам указал как «свой сервер» (рендерер сообщает его каналом net:allow-host).

import type { Session } from 'electron'

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/i

/** Домены облачных провайдеров (сам домен и его поддомены — api.openai.com, api.us.elevenlabs.io…) */
export const CLOUD_DOMAINS = [
  'deepseek.com', 'openai.com', 'anthropic.com', 'googleapis.com', 'openrouter.ai', 'groq.com', 'mistral.ai',
  'together.xyz', 'together.ai', 'x.ai', 'elevenlabs.io', 'cartesia.ai',
]

/** Сколько пользовательских хостов помним (защита от бесконечного роста) */
const MAX_CUSTOM_HOSTS = 20

export interface CorsPolicy {
  isAllowedHost(host: string): boolean
  /** Разрешает хост из адреса (http/https). Возвращает false, если адрес негодный или лимит исчерпан */
  allowHost(rawUrl: string): boolean
}

/** Совпадение по границе домена: api.openai.com — да, evilopenai.com — нет */
const matchesDomain = (host: string, domain: string) => host === domain || host.endsWith('.' + domain)

export function createCorsPolicy(): CorsPolicy {
  const custom = new Set<string>()
  return {
    isAllowedHost(rawHost: string): boolean {
      const host = String(rawHost ?? '').toLowerCase()
      if (!host) return false
      if (LOCAL.test(host)) return true
      if (CLOUD_DOMAINS.some((d) => matchesDomain(host, d))) return true
      return custom.has(host)
    },
    allowHost(rawUrl: string): boolean {
      let u: URL
      try { u = new URL(String(rawUrl)) } catch { return false }
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
      const host = u.hostname.toLowerCase()
      if (!host || !/^[a-z0-9.\-[\]:]+$/.test(host)) return false
      if (custom.has(host)) return true
      if (custom.size >= MAX_CUSTOM_HOSTS) return false
      custom.add(host)
      return true
    },
  }
}

/** Подставляет CORS-заголовки в ответы разрешённых хостов; preflight-запросы (OPTIONS) всегда отвечают 200 */
export function installCorsFix(ses: Session, policy: CorsPolicy = createCorsPolicy()): CorsPolicy {
  ses.webRequest.onHeadersReceived((details, callback) => {
    let host = ''
    try { host = new URL(details.url).hostname } catch { return callback({}) }
    if (!policy.isAllowedHost(host)) return callback({})

    const headers: Record<string, string | string[]> = { ...(details.responseHeaders ?? {}) }
    for (const k of Object.keys(headers)) if (/^access-control-/i.test(k)) delete headers[k]
    headers['Access-Control-Allow-Origin'] = ['*']
    headers['Access-Control-Allow-Methods'] = ['GET, POST, PUT, DELETE, OPTIONS']
    // Облачные API просят свои заголовки (x-api-key, anthropic-version, xi-api-key, cartesia-version…).
    // В onHeadersReceived заголовков запроса не видно, поэтому разрешаем фиксированный набор, который шлёт приложение
    headers['Access-Control-Allow-Headers'] = ['Content-Type, Authorization, Accept, X-Requested-With, x-api-key, anthropic-version, anthropic-dangerous-direct-browser-access, xi-api-key, cartesia-version']
    callback({
      responseHeaders: headers,
      ...(details.method === 'OPTIONS' ? { statusLine: 'HTTP/1.1 200 OK' } : {}),
    })
  })
  return policy
}
