// src/shared/services/imageGenService.ts
// Генерация картинок через локальный Stable Diffusion (Automatic1111, запуск с --api).
// Раньше здесь был пример с SiliconFlow и пустым ключом — он не мог работать,
// а чат вызывал SD отдельным кодом с зашитым адресом. Теперь всё в одном месте и настраивается.

import { hasCyrillic, type FetchLike } from '@shared/plugins/netUtil'
import { translateText } from '@shared/plugins/translator'

export interface SdConfig {
  endpoint: string
  steps: number
  width: number
  height: number
  negativePrompt: string
  stylePrompt: string
}

export interface GenerateImageOptions {
  signal?: AbortSignal
  /** Переводить русский промпт на английский перед отправкой (SD понимает русский плохо) */
  translate?: boolean
  width?: number
  height?: number
  /** Тегов-описаний персонажа, которые добавляются в начало промпта */
  prefix?: string
  fetchFn?: FetchLike
}

const trimSlash = (s: string) => s.replace(/\/+$/, '')

/** Быстрая проверка «А1111 вообще запущен?» */
export async function sdAvailable(endpoint: string, fetchFn?: FetchLike): Promise<boolean> {
  try {
    const f = fetchFn ?? ((u: string, i?: RequestInit) => fetch(u, i))
    const res = await f(`${trimSlash(endpoint)}/sdapi/v1/progress?skip_current_image=true`, {
      signal: AbortSignal.timeout(2500),
    })
    return res.ok
  } catch {
    return false
  }
}

/** Собирает итоговый промпт (чистая функция — удобно тестировать) */
export function composeSdPrompt(userPrompt: string, cfg: Pick<SdConfig, 'stylePrompt'>, prefix?: string): string {
  return [prefix, userPrompt, cfg.stylePrompt]
    .map((s) => (s ?? '').trim())
    .filter(Boolean)
    .join(', ')
}

/** Возвращает data:image/png;base64,... */
export async function generateImage(
  prompt: string,
  cfg: SdConfig,
  opts: GenerateImageOptions = {}
): Promise<string> {
  let text = prompt.trim()
  if (opts.translate !== false && hasCyrillic(text)) {
    try {
      text = await translateText(text, 'ru', 'en', opts.signal, opts.fetchFn)
    } catch {
      /* без перевода — хуже, но лучше, чем ничего */
    }
  }

  const payload = {
    prompt: composeSdPrompt(text, cfg, opts.prefix),
    negative_prompt: cfg.negativePrompt,
    steps: cfg.steps,
    width: opts.width ?? cfg.width,
    height: opts.height ?? cfg.height,
    cfg_scale: 7,
    sampler_name: 'Euler a',
    batch_size: 1,
    n_iter: 1,
    send_images: true,
    save_images: false,
  }

  const f = opts.fetchFn ?? ((u: string, i?: RequestInit) => fetch(u, i))
  const res = await f(`${trimSlash(cfg.endpoint)}/sdapi/v1/txt2img`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(240_000)]) : AbortSignal.timeout(240_000),
  })
  if (!res.ok) throw new Error(`Stable Diffusion API: HTTP ${res.status}`)

  const data = await res.json()
  const b64: string | undefined = data?.images?.[0]
  if (!b64) throw new Error('Stable Diffusion не вернул изображение')
  return `data:image/png;base64,${b64}`
}
