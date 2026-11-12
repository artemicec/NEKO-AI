// src/shared/services/setupChecks.ts
//
// Мастер настройки: что из окружения уже работает, а что ещё нужно поставить.
// Чистый модуль (без Vue/Electron): fetch подменяется в тестах. Все проверки идут ПАРАЛЛЕЛЬНО, у каждой свой таймаут,
// и ни одна не бросает исключение — «не отвечает» это обычный результат, а не ошибка.
//
// Ссылки и команды — подсказки: у сторонних проектов они меняются, поэтому подробности лежат в SETUP.md.

import type { AppSettings } from '@shared/types'
import { CLOUD_PRESETS, activeModel, isCloudProvider, providerLabel } from '@shared/services/providers'

export type CheckLevel = 'ok' | 'warn' | 'off' | 'fail'
export type SetupId = 'llm' | 'whisper' | 'chatterbox' | 'tts-cloud' | 'sd' | 'vrm' | 'animations'

export interface SetupItem {
  id: SetupId
  title: string
  /** Без этого приложение не работает по-настоящему (остальное — необязательные «приятности») */
  required: boolean
  /** ok — работает · warn — работает не до конца · off — не запущено (необязательно) · fail — не работает, а нужно */
  level: CheckLevel
  detail: string
  help?: { label: string; url: string }
  /** Команда, которую можно скопировать */
  command?: string
  /** Действие кнопкой в окне (работает только внутри приложения): скачать образец VRM в папку моделей */
  action?: { kind: 'download-vrm'; path: string }
}

/** Путь модели, который приложение умеет заполнять само (совпадает с проверкой в electron/modelFiles.ts) */
const DOWNLOADABLE_VRM = /^\/models\/[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.vrm$/i

export type SetupSettings = Pick<
  AppSettings,
  | 'provider' | 'ollamaEndpoint' | 'ollamaModel' | 'cloud'
  | 'whisperEndpoint' | 'sttEngine'
  | 'ttsEngine' | 'chatterboxEndpoint' | 'elevenlabsApiKey' | 'cartesiaApiKey'
  | 'sdEndpoint' | 'vrmModelPath' | 'ariaVrmModelPath'
>

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

export const LINKS = {
  ollama: { label: 'Скачать Ollama', url: 'https://ollama.com/download' },
  speaches: { label: 'Whisper-сервер (speaches)', url: 'https://github.com/speaches-ai/speaches' },
  chatterbox: { label: 'Chatterbox TTS', url: 'https://github.com/resemble-ai/chatterbox' },
  a1111: { label: 'Stable Diffusion WebUI (AUTOMATIC1111)', url: 'https://github.com/AUTOMATIC1111/stable-diffusion-webui' },
  elevenlabs: { label: 'Ключ ElevenLabs', url: 'https://elevenlabs.io/app/settings/api-keys' },
  cartesia: { label: 'Ключ Cartesia', url: 'https://play.cartesia.ai/keys' },
} as const

const TIMEOUT_MS = 3000
const FILE_TIMEOUT_MS = 5000
const trimSlash = (s: string) => s.replace(/\/+$/, '')

/** Совпадает ли установленная модель Ollama с настроенной («gemma4» == «gemma4:latest») */
export function ollamaHasModel(installed: string[], wanted: string): boolean {
  const w = wanted.trim().toLowerCase()
  if (!w) return false
  const want = w.includes(':') ? w : `${w}:latest`
  return installed.some((n) => n.trim().toLowerCase() === want)
}

/** Отвечает ли сервер вообще (любой HTTP-статус — «порт жив»). null — не отвечает */
async function probe(f: FetchFn, url: string): Promise<{ status: number; res: Response } | null> {
  try {
    const res = await f(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    return { status: res.status, res }
  } catch {
    return null
  }
}

/** Файл существует и это glTF/GLB (VRM и VRMA — это он и есть: первые 4 байта «glTF») */
export async function fileKind(f: FetchFn, url: string): Promise<'ok' | 'missing' | 'notglb'> {
  try {
    const res = await f(url, { signal: AbortSignal.timeout(FILE_TIMEOUT_MS) })
    if (!res.ok) return 'missing'
    // в dev-режиме Vite на несуществующий файл отвечает страницей index.html со статусом 200
    if (/text\/html/i.test(res.headers.get('content-type') ?? '')) return 'missing'
    let head: Uint8Array
    if (res.body && typeof res.body.getReader === 'function') {
      const reader = res.body.getReader()
      const first = await reader.read()
      void reader.cancel().catch(() => {}) // остальное не качаем — файл может быть на десятки мегабайт
      head = first.value ?? new Uint8Array()
    } else {
      head = new Uint8Array(await res.arrayBuffer())
    }
    return head.length >= 4 && String.fromCharCode(head[0], head[1], head[2], head[3]) === 'glTF' ? 'ok' : 'notglb'
  } catch {
    return 'missing'
  }
}

/* ───────────────────────── отдельные проверки ───────────────────────── */

export async function checkLlm(s: SetupSettings, f: FetchFn): Promise<SetupItem> {
  const base = { id: 'llm' as const, required: true }

  if (isCloudProvider(s.provider)) {
    const preset = CLOUD_PRESETS[s.provider]
    const cfg = s.cloud?.[s.provider]
    const title = `Нейросеть: ${preset.label}`
    if (preset.keyRequired && !cfg?.apiKey?.trim()) {
      return {
        ...base, title, level: 'fail',
        detail: 'Не указан API-ключ. Введи его в «Нейросеть и система» (ключ хранится только на этом компьютере).',
        help: preset.keyUrl ? { label: 'Где взять ключ', url: preset.keyUrl } : undefined,
      }
    }
    const { model } = activeModel(s)
    return {
      ...base, title, level: 'ok',
      detail: `Ключ указан, модель «${model}». Работоспособность выяснится при первом сообщении — отсюда запросы к облаку не отправляются.`,
    }
  }

  const title = 'Нейросеть: Ollama'
  const r = await probe(f, `${trimSlash(s.ollamaEndpoint)}/api/tags`)
  if (!r || r.status >= 400) {
    return {
      ...base, title, level: 'fail',
      detail: `Ollama не отвечает на ${s.ollamaEndpoint}. Установи и запусти её (значок в трее) — либо выбери облачного провайдера в «Нейросеть и система».`,
      help: LINKS.ollama,
    }
  }
  let names: string[] = []
  try {
    const data = (await r.res.json()) as { models?: { name?: string }[] }
    names = (data.models ?? []).map((m) => String(m.name ?? '')).filter(Boolean)
  } catch { /* ответ не JSON — считаем список пустым */ }
  if (ollamaHasModel(names, s.ollamaModel)) {
    return { ...base, title, level: 'ok', detail: `Ollama работает, модель «${s.ollamaModel}» установлена.` }
  }
  return {
    ...base, title, level: 'warn',
    detail: `Ollama работает, но модели «${s.ollamaModel}» нет. Скачай её (или выбери другую из списка в настройках).`,
    command: `ollama pull ${s.ollamaModel}`,
    help: LINKS.ollama,
  }
}

export async function checkWhisper(s: SetupSettings, f: FetchFn): Promise<SetupItem> {
  const base = { id: 'whisper' as const, required: false, title: 'Голосовой ввод: Whisper' }
  const r = await probe(f, `${trimSlash(s.whisperEndpoint)}/models`)
  if (!r) {
    return {
      ...base, level: 'off', help: LINKS.speaches,
      detail: `Сервер на ${s.whisperEndpoint} не отвечает. Без него не работает голосовой ввод (чат печатью — работает). Необязательно.`,
    }
  }
  if (r.status >= 400) {
    return { ...base, level: 'warn', detail: `Сервер отвечает, но «/models» вернул HTTP ${r.status}. Если это не OpenAI-совместимый Whisper — проверь адрес в «Голос и звук».` }
  }
  return {
    ...base, level: 'ok',
    detail: s.sttEngine === 'whisper' ? 'Сервер отвечает, Whisper выбран для голосового ввода.' : 'Сервер отвечает. Чтобы им пользоваться, выбери «Whisper» в «Голос и звук».',
  }
}

export async function checkChatterbox(s: SetupSettings, f: FetchFn): Promise<SetupItem> {
  const base = { id: 'chatterbox' as const, required: false, title: 'Озвучка: Chatterbox (локальная)' }
  const r = await probe(f, `${trimSlash(s.chatterboxEndpoint)}/health`)
  if (!r) {
    return {
      ...base, level: 'off', help: LINKS.chatterbox,
      detail: `Сервер на ${s.chatterboxEndpoint} не отвечает. Без него озвучка — встроенным голосом системы, либо облачная (ElevenLabs/Cartesia). Необязательно.`,
    }
  }
  return {
    ...base, level: 'ok',
    detail: s.ttsEngine === 'chatterbox' ? 'Сервер отвечает, Chatterbox выбран для озвучки.' : 'Сервер отвечает. Чтобы им пользоваться, выбери «Chatterbox» в «Голос и звук».',
  }
}

/** Только если выбран облачный голос: стоит ли ключ */
export function checkCloudTts(s: SetupSettings): SetupItem | null {
  if (s.ttsEngine !== 'elevenlabs' && s.ttsEngine !== 'cartesia') return null
  const isEleven = s.ttsEngine === 'elevenlabs'
  const key = (isEleven ? s.elevenlabsApiKey : s.cartesiaApiKey).trim()
  const name = isEleven ? 'ElevenLabs' : 'Cartesia'
  return key
    ? { id: 'tts-cloud', required: false, title: `Озвучка: ${name}`, level: 'ok', detail: 'Ключ указан. Кнопка «Проверить голос» в «Голос и звук» делает пробный запрос.' }
    : { id: 'tts-cloud', required: false, title: `Озвучка: ${name}`, level: 'warn', detail: 'Выбрана облачная озвучка, но ключ не указан — NEKO заговорит встроенным голосом.', help: isEleven ? LINKS.elevenlabs : LINKS.cartesia }
}

export async function checkSd(s: SetupSettings, f: FetchFn): Promise<SetupItem> {
  const base = { id: 'sd' as const, required: false, title: 'Картинки: Stable Diffusion' }
  const r = await probe(f, `${trimSlash(s.sdEndpoint)}/sdapi/v1/progress?skip_current_image=true`)
  if (r && r.status < 400) return { ...base, level: 'ok', detail: 'AUTOMATIC1111 запущен — можно просить нарисовать картинку и делать селфи для дневника.' }
  return {
    ...base, level: 'off', help: LINKS.a1111,
    detail: r
      ? `Сервер на ${s.sdEndpoint} отвечает, но API генерации недоступно (HTTP ${r.status}). Запускай WebUI с флагом --api.`
      : `Не запущен (${s.sdEndpoint}). Нужен для картинок и селфи в дневнике; запускай WebUI с флагом --api. Необязательно.`,
  }
}

export async function checkVrm(s: SetupSettings, persona: 'neko' | 'aria', f: FetchFn): Promise<SetupItem> {
  const path = persona === 'aria' ? s.ariaVrmModelPath : s.vrmModelPath
  const base = { id: 'vrm' as const, required: persona === 'neko', title: 'Модель аватара (VRM)' }
  const kind = path ? await fileKind(f, path) : 'missing'
  if (kind === 'ok') return { ...base, level: 'ok', detail: `Модель найдена: ${path}` }
  const lack = persona === 'aria'
    ? 'У ARIA вместо модели показывается «объектив» — это нормально.'
    : 'Без модели NEKO нет на экране (чат и память работают).'
  return {
    ...base,
    level: persona === 'aria' ? 'off' : 'fail',
    detail: kind === 'notglb'
      ? `Файл ${path} найден, но это не VRM-модель. ${lack}`
      : `Файла нет: ${path}. Нажми «Скачать образец» (он нужен для проверки; лицензию модели смотри у автора) или положи свою .vrm в папку моделей (кнопка ниже; в SETUP.md — подробности). ${lack}`,
    command: 'npm run models:download',
    ...(DOWNLOADABLE_VRM.test(path) ? { action: { kind: 'download-vrm' as const, path } } : {}),
  }
}

export async function checkAnimations(f: FetchFn): Promise<SetupItem> {
  const base = { id: 'animations' as const, required: false, title: 'Анимации аватара (.vrma)' }
  const kind = await fileKind(f, '/animations/VRMA_01.vrma')
  return kind === 'ok'
    ? { ...base, level: 'ok', detail: 'Анимации найдены.' }
    : { ...base, level: 'off', detail: 'Файлов public/animations/VRMA_01…07.vrma нет — аватар стоит в базовой позе без жестов. Необязательно.' }
}

/* ───────────────────────── всё вместе ───────────────────────── */

/** Все проверки параллельно. Порядок результата фиксированный — так список в окне не «прыгает» */
export async function runSetupChecks(s: SetupSettings, persona: 'neko' | 'aria', fetchFn?: FetchFn): Promise<SetupItem[]> {
  const f: FetchFn = fetchFn ?? ((u, i) => fetch(u, i))
  const guard = async (id: SetupId, title: string, p: () => Promise<SetupItem> | SetupItem | null): Promise<SetupItem | null> => {
    try { return await p() } catch (e) {
      return { id, title, required: false, level: 'warn', detail: `Не удалось проверить: ${(e as Error).message}` }
    }
  }
  const list = await Promise.all([
    guard('llm', 'Нейросеть', () => checkLlm(s, f)),
    guard('vrm', 'Модель аватара (VRM)', () => checkVrm(s, persona, f)),
    persona === 'neko' ? guard('animations', 'Анимации аватара', () => checkAnimations(f)) : Promise.resolve(null),
    guard('whisper', 'Голосовой ввод: Whisper', () => checkWhisper(s, f)),
    guard('chatterbox', 'Озвучка: Chatterbox', () => checkChatterbox(s, f)),
    guard('tts-cloud', 'Облачная озвучка', () => checkCloudTts(s)),
    guard('sd', 'Картинки: Stable Diffusion', () => checkSd(s, f)),
  ])
  return list.filter((x): x is SetupItem => !!x)
}

export interface SetupSummary {
  /** Обязательное работает — можно пользоваться */
  ready: boolean
  /** Сколько обязательных пунктов не в порядке */
  blockers: number
  /** Сколько необязательных не запущено или не настроено */
  optionalMissing: number
}

export function summarizeSetup(items: SetupItem[]): SetupSummary {
  const blockers = items.filter((i) => i.required && i.level !== 'ok').length
  const optionalMissing = items.filter((i) => !i.required && i.level !== 'ok').length
  // «warn» у обязательного (Ollama без модели) — тоже блокер: ответа не будет
  return { ready: blockers === 0, blockers, optionalMissing }
}

/** Значок для списка */
export const levelIcon = (l: CheckLevel): string => (l === 'ok' ? '✅' : l === 'warn' ? '⚠️' : l === 'off' ? '➖' : '⛔')

/**
 * Первый запуск: один раз сам открывает окно настроек на странице мастера.
 * Флаг ставится сразу при открытии — так мастер не лезет на глаза при каждом запуске,
 * а вернуться к нему всегда можно из «Настройки → Проверка и установка».
 * Возвращает true, если окно было запрошено.
 */
export function runFirstRunSetup(
  settings: { setupCompleted: boolean },
  open: (page: string) => unknown
): boolean {
  if (settings.setupCompleted) return false
  settings.setupCompleted = true
  try { void Promise.resolve(open('setup')).catch(() => {}) } catch { /* окно не открылось — не критично */ }
  return true
}

/** Название активного провайдера для заголовка мастера */
export const llmLabel = (s: Pick<AppSettings, 'provider'>) => providerLabel(s.provider)
