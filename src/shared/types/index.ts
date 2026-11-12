// src/shared/types/index.ts

/* ───────────────────────── Эмоции ───────────────────────── */

export type EmotionLabel =
  | 'joy'         // радость
  | 'affection'   // нежность / привязанность
  | 'playful'     // игривость
  | 'smug'        // самодовольство (цундэрэ-режим)
  | 'embarrassed' // смущение
  | 'annoyed'     // раздражение
  | 'sad'         // грусть
  | 'worried'     // беспокойство
  | 'curious'     // любопытство
  | 'sleepy'      // сонливость
  | 'excited'     // восторг
  | 'neutral'     // спокойствие

export interface EmotionTag {
  label: EmotionLabel
  /** 0..1 */
  intensity: number
}

/* ───────────────────────── Чат ───────────────────────── */

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  plugin?: string
  /** Откуда взяты данные, если ответ строился по информации из интернета (только http/https) */
  sources?: WebSource[]
  /** Какие дни NEKO вспомнила (дневник и переписка), если ответ опирался на воспоминания */
  recall?: { date: string; label: string }[]
  imageUrl?: string
  imageAlt?: string
  /** Эмоция NEKO в этом ответе (для assistant) — используется дневником и аватаром */
  emotion?: EmotionTag
  /** Ответ ещё стримится */
  streaming?: boolean
  /** Служебная ошибка (не уходит в контекст модели и не сохраняется) */
  error?: boolean
  /** Кнопки-исправления под сообщением об ошибке (только у error-сообщений) */
  fix?: ErrorFix[]
}

/** Что можно предложить одной кнопкой под ошибкой: 'use-ollama' — переключиться на локальную Ollama (работает без интернета) */
export type ErrorFix = 'use-ollama'

/** Источник, на который опирался ответ (показывается ссылкой под сообщением) */
export interface WebSource {
  title: string
  url: string
  kind: 'wikipedia' | 'web'
}

/** Сообщение в формате, который понимают LLM-провайдеры */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface NekoEmotion {
  type: 'kuudere' | 'deredere' | 'neutral'
  intensity: number
  expression: string
}

/* ───────────────────────── Плагины ───────────────────────── */

export interface PluginOutput {
  text: string
  imageUrl?: string
}

/** Всё, что плагинам нужно знать о настройках (плагины не ходят в Pinia сами) */
export interface PluginContext {
  signal?: AbortSignal
  settings: Pick<
    AppSettings,
    | 'defaultCity'
    | 'sdEndpoint' | 'sdSteps' | 'sdWidth' | 'sdHeight' | 'sdNegativePrompt' | 'sdStylePrompt'
    | 'webEnabled' | 'webAuto' | 'webWikipedia' | 'webResults'
    | 'remindersEnabled'
  >
}

export interface Plugin {
  name: string
  description: string
  icon: string
  /** Быстрая синхронная проверка — подходит ли плагин. Если не задана, вызывается execute(). */
  matches?: (input: string) => boolean
  /** Сколько ждать плагин (по умолчанию 12 с; генератору картинок нужно больше) */
  timeoutMs?: number
  /** Пустая строка = «это не моё сообщение» */
  execute: (input: string, ctx?: PluginContext) => Promise<string | PluginOutput>
}

export interface WeatherData {
  city: string
  temperature: number
  description: string
  humidity: number
  windSpeed: number
}

export interface NewsItem {
  title: string
  description: string
  url: string
  publishedAt: string
}

export interface VRMModel {
  url: string
  name: string
}

/* ───────────────────────── Дневник ───────────────────────── */

export interface DiaryThought {
  /** Короткая цитата сообщения пользователя, о котором мысль */
  about: string
  /** Что NEKO про это подумала */
  thought: string
  emotion: EmotionLabel
}

export type DiaryPhotoKind = 'selfie' | 'generated' | 'user' | 'card'

export interface DiaryPhoto {
  id: string
  /** Имя файла внутри папки diary/images (отдаётся через neko-diary://img/<file>) */
  file: string
  kind: DiaryPhotoKind
  caption: string
  /** Промпт, по которому сгенерирована картинка (для kind === 'generated') */
  prompt?: string
  createdAt: number
}

export interface DiaryMood {
  label: EmotionLabel
  intensity: number
  /** Одна фраза: «как я себя чувствовала сегодня» */
  summary: string
}

export interface DiaryEntry {
  id: string
  /** Локальная дата YYYY-MM-DD */
  date: string
  createdAt: number
  updatedAt: number
  title: string
  /** Основной текст записи (markdown-lite) */
  text: string
  mood: DiaryMood
  thoughts: DiaryThought[]
  photos: DiaryPhoto[]
  /** Сколько раз за период встретилась каждая эмоция */
  emotionStats: { label: EmotionLabel; count: number }[]
  /** Период сообщений, по которому написана запись */
  range: { from: number; to: number }
  messageCount: number
  source: 'auto' | 'manual'
  model?: string
}

/* ───────────────────────── Настройки ───────────────────────── */

/** Голос одного персонажа */
export interface VoiceProfile {
  /** Системный голос; пусто — подобрать автоматически (русский женский) */
  voiceName: string
  rate: number
  pitch: number
  /** Имя голоса в библиотеке Chatterbox */
  chatterboxVoice: string
  exaggeration: number
  cfgWeight: number
  temperature: number
  /** ID голоса в ElevenLabs (см. кнопку «Загрузить голоса» в настройках озвучки) */
  elevenlabsVoiceId: string
  /** ID голоса в Cartesia */
  cartesiaVoiceId: string
}

/* ───────── Провайдеры нейросетей ───────── */

/** Облачные провайдеры. Все, кроме `anthropic`, говорят на OpenAI-совместимом /chat/completions. */
export type CloudProviderId =
  | 'deepseek' | 'openai' | 'anthropic' | 'gemini'
  | 'openrouter' | 'groq' | 'mistral' | 'together' | 'xai'
  | 'custom'

export type ProviderId = 'ollama' | CloudProviderId

/** Настройки одного облачного провайдера (ключ хранится только локально, в localStorage окна) */
export interface CloudProviderConfig {
  apiKey: string
  /** Базовый адрес API, например https://api.openai.com/v1 */
  endpoint: string
  model: string
}

export type TtsEngine = 'browser' | 'chatterbox' | 'elevenlabs' | 'cartesia'

export interface AppSettings {
  settingsVersion: number

  // Провайдер
  provider: ProviderId

  // Ollama
  ollamaEndpoint: string
  ollamaModel: string
  /** Сколько Ollama держит модель в памяти после ответа («30m», «-1» = всегда) */
  ollamaKeepAlive: string
  /** Размер контекста. ДОЛЖЕН быть одинаковым во всех запросах, иначе Ollama перезагружает модель */
  numCtx: number
  /** Режим «размышлений» у thinking-моделей (qwen3 и т.п.). Выключено = быстрее */
  ollamaThink: boolean

  // Облачные провайдеры (DeepSeek, OpenAI, Anthropic, Gemini, OpenRouter, Groq, Mistral, Together, xAI, свой сервер)
  cloud: Record<CloudProviderId, CloudProviderConfig>

  // Генерация
  maxTokens: number
  temperature: number
  /** Сколько последних сообщений уходит в контекст */
  historyMessages: number
  /** Лимит символов контекста (грубая защита от переполнения) */
  historyChars: number

  // Тема / интерфейс
  theme: 'light' | 'dark'
  windowOpacity: number

  // Голос: у NEKO и ARIA профили разные (скорость, тон, голос, параметры Chatterbox)
  voices: Record<'neko' | 'aria', VoiceProfile>
  enableVoiceInput: boolean
  /** Чем распознавать речь: встроенным движком браузера (в Electron обычно не работает) или локальным Whisper */
  sttEngine: 'browser' | 'whisper'
  /** Адрес OpenAI-совместимого сервера Whisper (…/v1) */
  whisperEndpoint: string
  whisperModel: string
  /** 'ru', 'en'… или 'auto' */
  whisperLanguage: string
  /** Сколько тишины после фразы считать концом (мс) */
  whisperSilenceMs: number
  enableVoiceOutput: boolean
  ttsEngine: TtsEngine
  chatterboxEndpoint: string
  /** Язык озвучки для облачных движков (ElevenLabs/Cartesia): 'ru', 'en'… */
  ttsLanguage: string
  elevenlabsApiKey: string
  /** Базовый адрес ElevenLabs (по умолчанию https://api.elevenlabs.io) */
  elevenlabsEndpoint: string
  elevenlabsModel: string
  cartesiaApiKey: string
  cartesiaModel: string
  /** Липсинк: рот аватара двигается в такт озвучке */
  lipSync: boolean
  /** Размах рта, 0.3–1.5 (1 = как задумано) */
  lipSyncGain: number
  /** «Воспоминания»: на вопросы о прошлом NEKO ищет в дневнике и прошлой переписке (только NEKO) */
  memoryEnabled: boolean

  // Аватар
  vrmModelPath: string
  /** Модель ARIA — отдельный .vrm; нет файла — вместо неё показывается «объектив» */
  ariaVrmModelPath: string
  autoAnimate: boolean
  /**
   * Среднее время «спокойствия» в обычной позе между анимациями, секунды.
   * Анимации идут не подряд: после каждой аватар стоит в базовой позе, пауза ± случайный разброс.
   */
  animationPause: number
  maxFps: number

  // Плагины
  defaultCity: string

  // Stable Diffusion (Automatic1111)
  sdEndpoint: string
  sdSteps: number
  sdWidth: number
  sdHeight: number
  sdNegativePrompt: string
  sdStylePrompt: string

  // Интернет (поиск + Википедия)
  /** Главный выключатель: выключено — приложение вообще не ходит в сеть за знаниями */
  webEnabled: boolean
  /** Включаться само, когда информации не хватает (иначе — только по просьбе «найди в интернете…») */
  webAuto: boolean
  webWikipedia: boolean
  /** Сколько результатов поиска давать модели */
  webResults: number

  // Дневник NEKO
  diaryEnabled: boolean
  diaryAuto: boolean
  /** Минимум новых сообщений, чтобы NEKO села писать */
  diaryMinMessages: number
  /** Сколько минут тишины ждать после последнего сообщения */
  diaryIdleMinutes: number
  diarySelfie: boolean
  diaryGenerateImage: boolean

  // Окно / система
  /** Иконка в трее (меню «Открыть / Настройки / Выход») */
  trayEnabled: boolean
  /** Закрытие окна сворачивает приложение в трей, а не завершает его */
  closeToTray: boolean
  /** Плагин «Напомни мне…» */
  remindersEnabled: boolean
  /** Мастер первого запуска пройден (или пропущен) */
  setupCompleted: boolean
}
