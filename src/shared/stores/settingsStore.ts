// src/shared/stores/settingsStore.ts

import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { AppSettings, CloudProviderConfig, CloudProviderId, VoiceProfile } from '@shared/types'
import { defaultVoice } from '@shared/services/voicePresets'
import { CLOUD_PROVIDER_IDS, defaultCloudConfigs, isProviderId } from '@shared/services/providers'

export const SETTINGS_KEY = 'neko-settings'
export const SETTINGS_VERSION = 4

export const DEFAULT_SETTINGS: AppSettings = {
  settingsVersion: SETTINGS_VERSION,

  provider: 'ollama',

  // Ollama
  ollamaEndpoint: 'http://localhost:11434',
  ollamaModel: 'gemma4:e4b',
  ollamaKeepAlive: '30m',
  numCtx: 8192,
  ollamaThink: false,

  // Облачные провайдеры
  cloud: defaultCloudConfigs(),

  // Генерация
  maxTokens: 256,
  temperature: 0.7,
  historyMessages: 12,
  historyChars: 6000,

  // Интерфейс
  theme: 'dark',
  windowOpacity: 0.94,

  // Голос
  voices: { neko: defaultVoice('neko'), aria: defaultVoice('aria') },
  enableVoiceInput: true,
  sttEngine: 'browser',
  whisperEndpoint: 'http://localhost:8000/v1',
  whisperModel: 'Systran/faster-whisper-small',
  whisperLanguage: 'ru',
  whisperSilenceMs: 1200,
  enableVoiceOutput: true,
  ttsEngine: 'browser',
  chatterboxEndpoint: 'http://localhost:4123',
  ttsLanguage: 'ru',
  elevenlabsApiKey: '',
  elevenlabsEndpoint: 'https://api.elevenlabs.io',
  elevenlabsModel: 'eleven_multilingual_v2',
  cartesiaApiKey: '',
  cartesiaModel: 'sonic-3.6',
  lipSync: true,
  lipSyncGain: 1,
  memoryEnabled: true,

  // Аватар
  vrmModelPath: '/models/default.vrm',
  ariaVrmModelPath: '/models/aria.vrm',
  autoAnimate: true,
  animationPause: 30,
  maxFps: 30,

  // Плагины
  defaultCity: 'Москва',

  // Stable Diffusion
  sdEndpoint: 'http://127.0.0.1:7860',
  sdSteps: 20,
  sdWidth: 512,
  sdHeight: 512,
  sdNegativePrompt:
    'lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, cropped, worst quality, low quality, jpeg artifacts, signature, watermark, blurry',
  sdStylePrompt: 'anime style, masterpiece, best quality, soft lighting, detailed',

  // Интернет
  webEnabled: true,
  webAuto: true,
  webWikipedia: true,
  webResults: 5,

  // Дневник
  diaryEnabled: true,
  diaryAuto: true,
  diaryMinMessages: 6,
  diaryIdleMinutes: 20,
  diarySelfie: true,
  diaryGenerateImage: true,

  // Окно / система
  trayEnabled: true,
  closeToTray: true,
  remindersEnabled: true,
  setupCompleted: false,
}

const clamp = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}
const str = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : fallback)
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback)
const url = (v: unknown, fallback: string): string => {
  const s = str(v, fallback).trim().replace(/\/+$/, '')
  return s || fallback
}

const voiceProfile = (v: unknown, d: VoiceProfile): VoiceProfile => {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  return {
    voiceName: str(o.voiceName, d.voiceName),
    rate: clamp(o.rate, 0.5, 2, d.rate),
    pitch: clamp(o.pitch, 0.5, 2, d.pitch),
    chatterboxVoice: str(o.chatterboxVoice, d.chatterboxVoice).trim() || d.chatterboxVoice,
    elevenlabsVoiceId: str(o.elevenlabsVoiceId, d.elevenlabsVoiceId).trim(),
    cartesiaVoiceId: str(o.cartesiaVoiceId, d.cartesiaVoiceId).trim(),
    exaggeration: clamp(o.exaggeration, 0.25, 2, d.exaggeration),
    cfgWeight: clamp(o.cfgWeight, 0, 1, d.cfgWeight),
    temperature: clamp(o.temperature, 0.05, 1.5, d.temperature),
  }
}

/**
 * До 2.3 голос был один на двоих (speechRate/speechPitch/voiceName/chatterboxVoice).
 * Если пользователь его не трогал — NEKO получает новый «аниме»-профиль; если менял — его значения сохраняются.
 */
function legacyNekoVoice(s: Record<string, unknown>, d: VoiceProfile): unknown {
  const untouched =
    (s.speechRate === undefined || s.speechRate === 1) &&
    (s.speechPitch === undefined || s.speechPitch === 1) &&
    !s.voiceName &&
    (s.chatterboxVoice === undefined || s.chatterboxVoice === 'alloy')
  if (untouched) return undefined
  return { ...d, voiceName: s.voiceName, rate: s.speechRate, pitch: s.speechPitch, chatterboxVoice: s.chatterboxVoice }
}

/**
 * Настройки облачных провайдеров. До 0.1 был только DeepSeek (deepseekApiKey/Endpoint/Model) —
 * если нового блока `cloud` нет, берём значения оттуда, чтобы ключ не пропал при обновлении.
 */
function cloudConfigs(s: Record<string, unknown>): Record<CloudProviderId, CloudProviderConfig> {
  const d = defaultCloudConfigs()
  const saved = (s.cloud && typeof s.cloud === 'object' ? s.cloud : {}) as Record<string, unknown>
  const out = {} as Record<CloudProviderId, CloudProviderConfig>
  for (const id of CLOUD_PROVIDER_IDS) {
    const raw = (saved[id] && typeof saved[id] === 'object' ? saved[id] : {}) as Record<string, unknown>
    const legacy = id === 'deepseek' && !saved.deepseek
    out[id] = {
      apiKey: str(legacy ? s.deepseekApiKey : raw.apiKey, '').trim(),
      endpoint: url(legacy ? s.deepseekEndpoint : raw.endpoint, d[id].endpoint),
      // у «своего сервера» пустое имя модели допустимо (многие локальные серверы отвечают любой моделью)
      model: id === 'custom'
        ? str(raw.model, d[id].model).trim()
        : str(legacy ? s.deepseekModel : raw.model, d[id].model).trim() || d[id].model,
    }
  }
  return out
}

/** Чистая функция: сливает сохранённое с дефолтами и приводит значения к допустимым диапазонам */
export function sanitizeSettings(saved: Partial<AppSettings> | null | undefined): AppSettings {
  const d = DEFAULT_SETTINGS
  const s = (saved ?? {}) as Record<string, unknown>
  return {
    settingsVersion: SETTINGS_VERSION,
    provider: isProviderId(s.provider) ? s.provider : 'ollama',

    ollamaEndpoint: url(s.ollamaEndpoint, d.ollamaEndpoint),
    ollamaModel: str(s.ollamaModel, d.ollamaModel).trim() || d.ollamaModel,
    ollamaKeepAlive: str(s.ollamaKeepAlive, d.ollamaKeepAlive).trim() || d.ollamaKeepAlive,
    numCtx: Math.round(clamp(s.numCtx, 1024, 131072, d.numCtx)),
    ollamaThink: bool(s.ollamaThink, d.ollamaThink),

    cloud: cloudConfigs(s),

    maxTokens: Math.round(clamp(s.maxTokens, 16, 4096, d.maxTokens)),
    temperature: clamp(s.temperature, 0, 2, d.temperature),
    historyMessages: Math.round(clamp(s.historyMessages, 2, 60, d.historyMessages)),
    historyChars: Math.round(clamp(s.historyChars, 500, 60000, d.historyChars)),

    theme: s.theme === 'light' ? 'light' : 'dark',
    windowOpacity: clamp(s.windowOpacity, 0.4, 1, d.windowOpacity),

    voices: {
      neko: voiceProfile(
        (s.voices as Record<string, unknown> | undefined)?.neko ?? (s.voices ? undefined : legacyNekoVoice(s, d.voices.neko)),
        d.voices.neko
      ),
      aria: voiceProfile((s.voices as Record<string, unknown> | undefined)?.aria, d.voices.aria),
    },
    enableVoiceInput: bool(s.enableVoiceInput, d.enableVoiceInput),
    sttEngine: s.sttEngine === 'whisper' ? 'whisper' : 'browser',
    whisperEndpoint: url(s.whisperEndpoint, d.whisperEndpoint),
    whisperModel: str(s.whisperModel, d.whisperModel).trim() || d.whisperModel,
    whisperLanguage: /^(auto|[a-z]{2,3})$/i.test(str(s.whisperLanguage, '').trim()) ? str(s.whisperLanguage, '').trim().toLowerCase() : d.whisperLanguage,
    whisperSilenceMs: Math.round(clamp(s.whisperSilenceMs, 500, 3000, d.whisperSilenceMs)),
    enableVoiceOutput: bool(s.enableVoiceOutput, d.enableVoiceOutput),
    ttsEngine: (['chatterbox', 'elevenlabs', 'cartesia'] as const).find((e) => e === s.ttsEngine) ?? 'browser',
    chatterboxEndpoint: url(s.chatterboxEndpoint, d.chatterboxEndpoint),
    ttsLanguage: /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(str(s.ttsLanguage, '').trim()) ? str(s.ttsLanguage, '').trim() : d.ttsLanguage,
    elevenlabsApiKey: str(s.elevenlabsApiKey, d.elevenlabsApiKey).trim(),
    elevenlabsEndpoint: url(s.elevenlabsEndpoint, d.elevenlabsEndpoint),
    elevenlabsModel: str(s.elevenlabsModel, d.elevenlabsModel).trim() || d.elevenlabsModel,
    cartesiaApiKey: str(s.cartesiaApiKey, d.cartesiaApiKey).trim(),
    cartesiaModel: str(s.cartesiaModel, d.cartesiaModel).trim() || d.cartesiaModel,
    lipSync: bool(s.lipSync, d.lipSync),
    lipSyncGain: Math.round(clamp(s.lipSyncGain, 0.3, 1.5, d.lipSyncGain) * 100) / 100,
    memoryEnabled: bool(s.memoryEnabled, d.memoryEnabled),

    vrmModelPath: str(s.vrmModelPath, d.vrmModelPath),
    ariaVrmModelPath: str(s.ariaVrmModelPath, d.ariaVrmModelPath),
    autoAnimate: bool(s.autoAnimate, d.autoAnimate),
    animationPause: Math.round(clamp(s.animationPause, 5, 300, d.animationPause)),
    maxFps: Math.round(clamp(s.maxFps, 10, 60, d.maxFps)),

    defaultCity: str(s.defaultCity, d.defaultCity).trim() || d.defaultCity,

    sdEndpoint: url(s.sdEndpoint, d.sdEndpoint),
    sdSteps: Math.round(clamp(s.sdSteps, 1, 150, d.sdSteps)),
    sdWidth: Math.round(clamp(s.sdWidth, 256, 1536, d.sdWidth) / 8) * 8,
    sdHeight: Math.round(clamp(s.sdHeight, 256, 1536, d.sdHeight) / 8) * 8,
    sdNegativePrompt: str(s.sdNegativePrompt, d.sdNegativePrompt),
    sdStylePrompt: str(s.sdStylePrompt, d.sdStylePrompt),

    webEnabled: bool(s.webEnabled, d.webEnabled),
    webAuto: bool(s.webAuto, d.webAuto),
    webWikipedia: bool(s.webWikipedia, d.webWikipedia),
    webResults: Math.round(clamp(s.webResults, 2, 8, d.webResults)),

    diaryEnabled: bool(s.diaryEnabled, d.diaryEnabled),
    diaryAuto: bool(s.diaryAuto, d.diaryAuto),
    diaryMinMessages: Math.round(clamp(s.diaryMinMessages, 2, 200, d.diaryMinMessages)),
    diaryIdleMinutes: Math.round(clamp(s.diaryIdleMinutes, 1, 240, d.diaryIdleMinutes)),
    diarySelfie: bool(s.diarySelfie, d.diarySelfie),
    diaryGenerateImage: bool(s.diaryGenerateImage, d.diaryGenerateImage),

    trayEnabled: bool(s.trayEnabled, d.trayEnabled),
    closeToTray: bool(s.closeToTray, d.closeToTray),
    remindersEnabled: bool(s.remindersEnabled, d.remindersEnabled),
    // Пользователь, у которого настройки уже были до 0.1, мастер первого запуска не видит
    setupCompleted: bool(s.setupCompleted, Object.keys(s).length > 0),
  }
}

const safeGet = (k: string): string | null => {
  try { return localStorage.getItem(k) } catch { return null }
}
const safeSet = (k: string, v: string) => {
  try { localStorage.setItem(k, v) } catch { /* переполнение/запрет — не критично */ }
}

export const useSettingsStore = defineStore('settings', () => {
  // sanitizeSettings(null) отдаёт свежие вложенные объекты (voices, cloud), а не общие с DEFAULT_SETTINGS
  const settings = ref<AppSettings>(sanitizeSettings(null))

  const applyTheme = (theme: 'light' | 'dark') => {
    document.documentElement.setAttribute('data-theme', theme)
    safeSet('neko-theme', theme)
  }

  /** Прозрачность карточек окон: CSS-переменная, которую используют окна чата/настроек/дневника */
  const applyOpacity = (v: number) => {
    document.documentElement.style.setProperty('--card-alpha', String(v))
  }

  const applyAll = () => {
    applyTheme(settings.value.theme)
    applyOpacity(settings.value.windowOpacity)
  }

  const loadSettings = () => {
    const raw = safeGet(SETTINGS_KEY)
    if (raw) {
      try {
        settings.value = sanitizeSettings(JSON.parse(raw))
      } catch (e) {
        console.error('Ошибка загрузки настроек:', e)
      }
    }
    applyAll()
  }

  let saveTimer: ReturnType<typeof setTimeout> | null = null
  const writeNow = () => {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
    const json = JSON.stringify(settings.value)
    if (safeGet(SETTINGS_KEY) !== json) safeSet(SETTINGS_KEY, json)
  }
  /** Запись с задержкой: чтобы не писать в localStorage на каждую набранную букву */
  const saveSettings = () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(writeNow, 250)
  }

  const toggleTheme = () => {
    settings.value.theme = settings.value.theme === 'light' ? 'dark' : 'light'
  }

  loadSettings()

  watch(settings, saveSettings, { deep: true })
  watch(() => settings.value.theme, applyTheme)
  watch(() => settings.value.windowOpacity, applyOpacity)

  // Окна Electron — это отдельные процессы рендера со своими store.
  // localStorage общий, поэтому подхватываем изменения, сделанные в другом окне.
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('storage', (e: StorageEvent) => {
      if (e.key !== SETTINGS_KEY || !e.newValue) return
      try {
        const incoming = sanitizeSettings(JSON.parse(e.newValue))
        if (JSON.stringify(incoming) !== JSON.stringify(settings.value)) {
          settings.value = incoming
          applyAll()
        }
      } catch { /* битый JSON — игнорируем */ }
    })
    window.addEventListener('beforeunload', writeNow)
  }

  return { settings, loadSettings, saveSettings, toggleTheme, applyTheme }
})
