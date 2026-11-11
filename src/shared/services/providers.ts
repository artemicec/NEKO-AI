// src/shared/services/providers.ts
// Каталог облачных провайдеров нейросетей. Чистый модуль (без Vue/Electron) — его используют и настройки,
// и фабрика провайдеров, и тесты.
//
// Все провайдеры, кроме Anthropic, принимают OpenAI-совместимый POST {endpoint}/chat/completions со стримом SSE.
// Gemini подключён через его OpenAI-совместимый слой (…/v1beta/openai), поэтому отдельного сервиса ему не нужно.
// Модели по умолчанию — просто подсказка: список настоящих моделей подтягивается кнопкой «Список моделей»
// (GET {endpoint}/models), так что устаревшее имя здесь не блокирует работу.

import type { AppSettings, CloudProviderConfig, CloudProviderId, ProviderId } from '@shared/types'

export type ProviderKind = 'openai' | 'anthropic'

export interface ProviderPreset {
  id: CloudProviderId
  label: string
  /** Какой протокол использовать */
  kind: ProviderKind
  endpoint: string
  model: string
  /** Где взять ключ (ссылка открывается в браузере) */
  keyUrl: string
  /** false — сервер без ключа (свой LM Studio / vLLM и т.п.) */
  keyRequired: boolean
  /** Подсказка пользователю под полем */
  hint: string
}

export const CLOUD_PRESETS: Record<CloudProviderId, ProviderPreset> = {
  deepseek: {
    id: 'deepseek', label: 'DeepSeek', kind: 'openai',
    endpoint: 'https://api.deepseek.com/v1', model: 'deepseek-chat',
    keyUrl: 'https://platform.deepseek.com/api_keys', keyRequired: true,
    hint: 'Дёшево и хорошо говорит по-русски.',
  },
  openai: {
    id: 'openai', label: 'OpenAI', kind: 'openai',
    endpoint: 'https://api.openai.com/v1', model: 'gpt-4o-mini',
    keyUrl: 'https://platform.openai.com/api-keys', keyRequired: true,
    hint: 'Имя модели по умолчанию может устареть — нажмите «Список моделей» и выберите актуальную.',
  },
  anthropic: {
    id: 'anthropic', label: 'Anthropic (Claude)', kind: 'anthropic',
    endpoint: 'https://api.anthropic.com/v1', model: 'claude-haiku-5-5',
    keyUrl: 'https://console.anthropic.com/settings/keys', keyRequired: true,
    hint: 'Haiku — самый быстрый и дешёвый; для «умных» ответов выберите Sonnet.',
  },
  gemini: {
    id: 'gemini', label: 'Google Gemini', kind: 'openai',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.8-flash',
    keyUrl: 'https://aistudio.google.com/apikey', keyRequired: true,
    hint: 'Ключ из Google AI Studio. Подключено через OpenAI-совместимый слой Gemini.',
  },
  openrouter: {
    id: 'openrouter', label: 'OpenRouter', kind: 'openai',
    endpoint: 'https://openrouter.ai/api/v1', model: 'openrouter/auto',
    keyUrl: 'https://openrouter.ai/keys', keyRequired: true,
    hint: 'Один ключ — сотни моделей разных компаний. Имена вида «компания/модель».',
  },
  groq: {
    id: 'groq', label: 'Groq', kind: 'openai',
    endpoint: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile',
    keyUrl: 'https://console.groq.com/keys', keyRequired: true,
    hint: 'Очень быстрый вывод открытых моделей.',
  },
  mistral: {
    id: 'mistral', label: 'Mistral', kind: 'openai',
    endpoint: 'https://api.mistral.ai/v1', model: 'mistral-small-latest',
    keyUrl: 'https://console.mistral.ai/api-keys', keyRequired: true,
    hint: '',
  },
  together: {
    id: 'together', label: 'Together AI', kind: 'openai',
    endpoint: 'https://api.together.xyz/v1', model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    keyUrl: 'https://api.together.ai/settings/api-keys', keyRequired: true,
    hint: '',
  },
  xai: {
    id: 'xai', label: 'xAI (Grok)', kind: 'openai',
    endpoint: 'https://api.x.ai/v1', model: 'grok-3-mini',
    keyUrl: 'https://console.x.ai', keyRequired: true,
    hint: 'Имя модели по умолчанию может устареть — нажмите «Список моделей».',
  },
  custom: {
    id: 'custom', label: 'Свой сервер (OpenAI-совместимый)', kind: 'openai',
    endpoint: 'http://localhost:1234/v1', model: '',
    keyUrl: '', keyRequired: false,
    hint: 'LM Studio, vLLM, llama.cpp server, LiteLLM и любой другой сервер с /v1/chat/completions. Ключ — только если сервер его требует.',
  },
}

export const CLOUD_PROVIDER_IDS = Object.keys(CLOUD_PRESETS) as CloudProviderId[]

export const isCloudProvider = (id: unknown): id is CloudProviderId =>
  typeof id === 'string' && Object.prototype.hasOwnProperty.call(CLOUD_PRESETS, id)

export const isProviderId = (id: unknown): id is ProviderId => id === 'ollama' || isCloudProvider(id)

export const providerLabel = (id: ProviderId): string => (id === 'ollama' ? 'Ollama' : CLOUD_PRESETS[id].label)

/** Модель и адрес ТЕКУЩЕГО провайдера (для подписей, ошибок и расчёта бюджета дневника) */
export function activeModel(s: Pick<AppSettings, 'provider' | 'ollamaModel' | 'ollamaEndpoint' | 'cloud'>): { model: string; endpoint: string } {
  if (isCloudProvider(s.provider)) {
    const c = s.cloud[s.provider]
    return { model: c.model, endpoint: c.endpoint }
  }
  return { model: s.ollamaModel, endpoint: s.ollamaEndpoint }
}

/** Свежая копия настроек всех облачных провайдеров (адреса и модели — по умолчанию, ключи пустые) */
export function defaultCloudConfigs(): Record<CloudProviderId, CloudProviderConfig> {
  const out = {} as Record<CloudProviderId, CloudProviderConfig>
  for (const id of CLOUD_PROVIDER_IDS) {
    const p = CLOUD_PRESETS[id]
    out[id] = { apiKey: '', endpoint: p.endpoint, model: p.model }
  }
  return out
}
