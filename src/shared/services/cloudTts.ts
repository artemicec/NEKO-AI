// src/shared/services/cloudTts.ts
// Облачная озвучка: ElevenLabs и Cartesia. Чистый fetch, без зависимостей. Возвращает «сырое» аудио (ArrayBuffer),
// которое SpeechOutput декодирует и проигрывает так же, как звук Chatterbox — поэтому липсинк работает по настоящему звуку.
//
// Форматы запросов сверены с документацией ElevenLabs (POST /v1/text-to-speech/{voice_id}, заголовок xi-api-key) и
// Cartesia (POST /tts/bytes, Bearer + Cartesia-Version). Вживую из среды разработки они не проверялись —
// только против локального сервера-заглушки (tests/tts_cloud.test.ts).
// Ключ уходит только в заголовке на хост провайдера и никогда не попадает в тексты ошибок и логи.

import { allowCloudHost } from './corsHosts'

export type CloudTtsEngine = 'elevenlabs' | 'cartesia'

export const ELEVENLABS_DEFAULT_ENDPOINT = 'https://api.elevenlabs.io'
export const CARTESIA_ENDPOINT = 'https://api.cartesia.ai'
/** По документации Cartesia — единственное допустимое значение заголовка Cartesia-Version */
export const CARTESIA_VERSION = '2026-08-14'

export interface CloudTtsConfig {
  apiKey: string
  model: string
  voiceId: string
  /** 'ru', 'en'… */
  language: string
  /** Скорость речи (voice.rate); у каждого сервиса свой допустимый диапазон — приводим сами */
  speed: number
  /** Базовый адрес API. ElevenLabs: регион; Cartesia: обычно не нужен (для тестов и прокси) */
  endpoint?: string
}

export class TtsError extends Error {
  constructor(message: string, public kind: 'config' | 'auth' | 'quota' | 'voice' | 'language' | 'http' | 'network' | 'aborted', public status?: number) {
    super(message)
    this.name = 'TtsError'
  }
}

export const ENGINE_LABEL: Record<CloudTtsEngine, string> = { elevenlabs: 'ElevenLabs', cartesia: 'Cartesia' }

const trimSlash = (s: string) => s.replace(/\/+$/, '')
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : 1))

/** Готова ли конфигурация к запросу (иначе облако не трогаем — просто системный голос) */
export function cloudConfigured(cfg: Pick<CloudTtsConfig, 'apiKey' | 'voiceId'>): boolean {
  return !!cfg.apiKey.trim() && !!cfg.voiceId.trim()
}

/** Достаёт короткое сообщение из тела ошибки ElevenLabs/Cartesia (JSON с detail/message/error либо текст) */
export function errorDetail(raw: string): string {
  const text = raw.trim()
  if (!text) return ''
  try {
    const j = JSON.parse(text)
    const d = j?.detail ?? j?.message ?? j?.error ?? j
    if (typeof d === 'string') return d.slice(0, 200)
    if (Array.isArray(d)) return d.map((x) => (typeof x === 'string' ? x : x?.msg ?? '')).filter(Boolean).join('; ').slice(0, 200)
    if (d && typeof d === 'object') return String((d as any).message ?? (d as any).status ?? JSON.stringify(d)).slice(0, 200)
  } catch { /* не JSON */ }
  return text.slice(0, 200)
}

/** Преобразует HTTP-ошибку в TtsError с понятным русским текстом (без ключа) */
export function httpToTtsError(engine: CloudTtsEngine, status: number, raw: string): TtsError {
  const name = ENGINE_LABEL[engine]
  const detail = errorDetail(raw)
  const tail = detail ? ` (${detail})` : ''
  if (status === 401 || status === 403) return new TtsError(`${name} отклонил ключ или доступ (${status}). Проверь API-ключ и тариф${tail}`, 'auth', status)
  if (status === 402 || status === 429) return new TtsError(`${name}: закончился лимит символов/баланс или слишком много запросов (${status})${tail}`, 'quota', status)
  if (status === 404) return new TtsError(`${name}: нет голоса с таким ID. Выбери голос из списка («Загрузить голоса»)${tail}`, 'voice', status)
  if (status === 400 || status === 422) {
    if (/language|locale|язык/i.test(detail)) return new TtsError(`${name}: выбранный язык не поддерживается этой моделью. Смени язык или модель${tail}`, 'language', status)
    return new TtsError(`${name} не принял запрос (${status})${tail}`, 'http', status)
  }
  return new TtsError(`${name} ответил ошибкой ${status}${tail}`, 'http', status)
}

async function send(engine: CloudTtsEngine, url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
  let res: Response
  try {
    res = await fetch(url, { ...init, signal: signal ?? AbortSignal.timeout(30_000) })
  } catch (e) {
    if (signal?.aborted || (e as { name?: string })?.name === 'AbortError') throw new TtsError('Прервано', 'aborted')
    throw new TtsError(`Не могу достучаться до ${ENGINE_LABEL[engine]}. Проверь интернет.`, 'network')
  }
  if (!res.ok) throw httpToTtsError(engine, res.status, await res.text().catch(() => ''))
  return res
}

/* ───────────────────────── ElevenLabs ───────────────────────── */

const elBase = (cfg: Pick<CloudTtsConfig, 'endpoint'>) => trimSlash(cfg.endpoint || ELEVENLABS_DEFAULT_ENDPOINT)
const caBase = (cfg: Pick<CloudTtsConfig, 'endpoint'>) => trimSlash(cfg.endpoint || CARTESIA_ENDPOINT)

/** Тело запроса ElevenLabs. language_code у моделей multilingual_v2 не поддерживается — для них не отправляем */
export function elevenLabsBody(text: string, cfg: CloudTtsConfig): Record<string, unknown> {
  const model = cfg.model || 'eleven_multilingual_v2'
  const body: Record<string, unknown> = {
    text,
    model_id: model,
    voice_settings: {
      stability: 0.5,
      similarity_boost: 0.75,
      style: 0,
      speed: clamp(cfg.speed, 0.7, 1.2),
      use_speaker_boost: true,
    },
  }
  if (model !== 'eleven_multilingual_v2' && cfg.language) body.language_code = cfg.language.split('-')[0].toLowerCase()
  return body
}

export async function synthElevenLabs(text: string, cfg: CloudTtsConfig, signal?: AbortSignal): Promise<ArrayBuffer> {
  if (!cloudConfigured(cfg)) throw new TtsError('Не указан API-ключ или ID голоса ElevenLabs («Голос» в настройках).', 'config')
  const base = elBase(cfg)
  await allowCloudHost(base)
  const res = await send(
    'elevenlabs',
    `${base}/v1/text-to-speech/${encodeURIComponent(cfg.voiceId.trim())}`,
    {
      method: 'POST',
      headers: { 'xi-api-key': cfg.apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify(elevenLabsBody(text, cfg)),
    },
    signal
  )
  return await res.arrayBuffer()
}

/* ───────────────────────── Cartesia ───────────────────────── */

/** Модели sonic-3 и новее понимают generation_config (скорость/громкость) */
export const cartesiaSupportsGenerationConfig = (model: string): boolean => /^sonic-(3|latest)/i.test(model) || /^sonic-([4-9]|\d{2,})/i.test(model)

export function cartesiaBody(text: string, cfg: CloudTtsConfig): Record<string, unknown> {
  const model = cfg.model || 'sonic-3.6'
  const body: Record<string, unknown> = {
    model_id: model,
    transcript: text,
    voice: { id: cfg.voiceId.trim() },
    // WAV 16 бит 24 кГц: декодируется браузером без потерь, быстрее и легче, чем 44.1 кГц
    output_format: { container: 'wav', encoding: 'pcm_s16le', sample_rate: 24000 },
  }
  if (cfg.language) body.language = cfg.language.split('-')[0].toLowerCase() // language и locale взаимоисключимы — шлём только language
  if (cartesiaSupportsGenerationConfig(model)) body.generation_config = { speed: clamp(cfg.speed, 0.6, 1.5), volume: 1 }
  return body
}

const cartesiaHeaders = (apiKey: string): Record<string, string> => ({
  Authorization: `Bearer ${apiKey}`,
  'Cartesia-Version': CARTESIA_VERSION,
})

export async function synthCartesia(text: string, cfg: CloudTtsConfig, signal?: AbortSignal): Promise<ArrayBuffer> {
  if (!cloudConfigured(cfg)) throw new TtsError('Не указан API-ключ или ID голоса Cartesia («Голос» в настройках).', 'config')
  const base = caBase(cfg)
  await allowCloudHost(base)
  const res = await send(
    'cartesia',
    `${base}/tts/bytes`,
    {
      method: 'POST',
      headers: { ...cartesiaHeaders(cfg.apiKey), 'Content-Type': 'application/json' },
      body: JSON.stringify(cartesiaBody(text, cfg)),
    },
    signal
  )
  return await res.arrayBuffer()
}

/* ───────────────────────── Списки голосов / проверка ключа ───────────────────────── */

export interface CloudVoice { id: string; name: string; language?: string }

export async function listCloudVoices(
  engine: CloudTtsEngine,
  cfg: Pick<CloudTtsConfig, 'apiKey' | 'endpoint'>,
  signal?: AbortSignal
): Promise<CloudVoice[]> {
  if (!cfg.apiKey.trim()) throw new TtsError(`Не указан API-ключ ${ENGINE_LABEL[engine]}.`, 'config')
  if (engine === 'elevenlabs') {
    const base = elBase(cfg)
    await allowCloudHost(base)
    const res = await send('elevenlabs', `${base}/v1/voices`, { headers: { 'xi-api-key': cfg.apiKey } }, signal ?? AbortSignal.timeout(10_000))
    const json: any = await res.json().catch(() => ({}))
    return (Array.isArray(json?.voices) ? json.voices : [])
      .filter((v: any) => typeof v?.voice_id === 'string')
      .map((v: any): CloudVoice => ({ id: v.voice_id, name: String(v.name ?? v.voice_id), language: v.labels?.language }))
  }
  const base = caBase(cfg)
  await allowCloudHost(base)
  const res = await send('cartesia', `${base}/voices`, { headers: cartesiaHeaders(cfg.apiKey) }, signal ?? AbortSignal.timeout(10_000))
  const json: any = await res.json().catch(() => ({}))
  const rows: any[] = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : []
  return rows
    .filter((v) => typeof v?.id === 'string')
    .map((v): CloudVoice => ({ id: v.id, name: String(v.name ?? v.id), language: typeof v.language === 'string' ? v.language : undefined }))
}

/** Текст для пользователя по любой ошибке озвучки */
export function describeTtsError(e: unknown, engine: CloudTtsEngine): string {
  if (e instanceof TtsError) return e.kind === 'aborted' ? '' : e.message
  if (e instanceof DOMException && e.name === 'AbortError') return ''
  return `Не удалось получить голос от ${ENGINE_LABEL[engine]}.`
}
