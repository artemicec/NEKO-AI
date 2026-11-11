// src/shared/plugins/imageGenPlugin.ts
import type { Plugin, PluginContext, PluginOutput } from '@shared/types'
import { generateImage, type SdConfig } from '@shared/services/imageGenService'

const REQUEST = /^(?:ну\s+)?(?:пожалуйста[,\s]*)?(?:нарисуй|сгенерируй|изобрази|создай\s+(?:картинку|изображение|арт)|сделай\s+(?:картинку|арт))\s*:?\s+(.{3,})$/iu

export function extractImagePrompt(input: string): string | null {
  const m = REQUEST.exec(input.trim())
  return m ? m[1].trim() : null
}

export class ImageGenPlugin implements Plugin {
  name = 'Генерация картинок'
  description = 'Создать изображение по описанию'
  icon = '🎨'
  timeoutMs = 240_000

  matches(input: string): boolean {
    return extractImagePrompt(input) !== null
  }

  async execute(input: string, ctx?: PluginContext): Promise<string | PluginOutput> {
    const prompt = extractImagePrompt(input)
    if (!prompt) return ''
    if (!ctx) return 'Для рисования мне нужны настройки Stable Diffusion.'

    const s = ctx.settings
    const cfg: SdConfig = {
      endpoint: s.sdEndpoint,
      steps: s.sdSteps,
      width: s.sdWidth,
      height: s.sdHeight,
      negativePrompt: s.sdNegativePrompt,
      stylePrompt: s.sdStylePrompt,
    }
    try {
      const imageUrl = await generateImage(prompt, cfg, { signal: ctx.signal })
      return { text: `Вот что получилось по запросу «${prompt}»`, imageUrl }
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') throw e
      return 'Не получилось нарисовать: проверь, запущен ли Stable Diffusion (webui с флагом --api) и адрес в настройках.'
    }
  }
}
