// src/shared/services/aiFactory.ts
// Собирает провайдера из ТЕКУЩИХ настроек (создаётся на каждый запрос — настройки всегда свежие).

import type { AppSettings } from '@shared/types'
import type { AIProvider } from './aiTypes'
import { OllamaService } from './ollamaService'
import { OpenAICompatService } from './openaiCompatService'
import { AnthropicService } from './anthropicService'
import { CLOUD_PRESETS, isCloudProvider } from './providers'

export function createProvider(s: AppSettings): AIProvider {
  if (isCloudProvider(s.provider)) {
    const cfg = s.cloud[s.provider]
    const common = { apiKey: cfg.apiKey, endpoint: cfg.endpoint, model: cfg.model, maxTokens: s.maxTokens, temperature: s.temperature }
    return CLOUD_PRESETS[s.provider].kind === 'anthropic'
      ? new AnthropicService(common)
      : new OpenAICompatService({ id: s.provider, ...common })
  }
  return new OllamaService({
    endpoint: s.ollamaEndpoint,
    model: s.ollamaModel,
    keepAlive: s.ollamaKeepAlive,
    numCtx: s.numCtx,
    think: s.ollamaThink,
    maxTokens: s.maxTokens,
    temperature: s.temperature,
  })
}
