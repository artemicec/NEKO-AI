// src/shared/services/pluginManager.ts

import type { Plugin, PluginContext, PluginOutput } from '@shared/types'
import { CalculatorPlugin } from '@shared/plugins/calculator'
import { TranslatorPlugin } from '@shared/plugins/translator'
import { NewsPlugin } from '@shared/plugins/newsPlugin'
import { WeatherPlugin } from '@shared/plugins/weatherPlugin'
import { FactPlugin } from '@shared/plugins/factPlugin'
import { ImageGenPlugin } from '@shared/plugins/imageGenPlugin'
import { InternetPlugin } from '@shared/plugins/internetPlugin'
import { ReminderPlugin } from '@shared/plugins/reminderPlugin'

export interface PluginResult {
  plugin: string
  result: PluginOutput
}

const DEFAULT_TIMEOUT = 12_000

export class PluginManager {
  private plugins: Plugin[]
  /** «Интернет» отвечает не напрямую, а через модель, поэтому чат обращается к нему отдельно (matches() у него всегда false) */
  readonly internet: InternetPlugin

  constructor(plugins?: Plugin[]) {
    this.plugins = plugins ?? [
      new ReminderPlugin(), // первым: во фразе «через 10 минут» есть цифры, и калькулятор не должен её перехватывать
      new CalculatorPlugin(),
      new TranslatorPlugin(),
      new WeatherPlugin(),
      new NewsPlugin(),
      new FactPlugin(),
      new ImageGenPlugin(), // раньше был написан, но нигде не подключён
      new InternetPlugin(),
    ]
    this.internet = this.plugins.find((p): p is InternetPlugin => p instanceof InternetPlugin) ?? new InternetPlugin()
  }

  /** Синхронно: есть ли плагин, который наверняка возьмётся за это сообщение */
  find(input: string): Plugin | null {
    for (const p of this.plugins) {
      try {
        if (p.matches?.(input)) return p
      } catch { /* битый matches не должен ронять чат */ }
    }
    return null
  }

  /**
   * Запускает подходящий плагин с таймаутом.
   * Плагины без matches() опрашиваются через execute() (пустая строка = «не моё»).
   * Если пользователь нажал «Стоп» (ctx.signal) — пробрасывает AbortError.
   */
  async processInput(input: string, ctx: PluginContext): Promise<PluginResult | null> {
    const candidates = this.plugins.filter((p) => {
      if (!p.matches) return true
      try { return p.matches(input) } catch { return false }
    })

    for (const plugin of candidates) {
      const timeout = AbortSignal.timeout(plugin.timeoutMs ?? DEFAULT_TIMEOUT)
      const signal = ctx.signal ? AbortSignal.any([ctx.signal, timeout]) : timeout
      try {
        const raw = await plugin.execute(input, { ...ctx, signal })
        const out: PluginOutput = typeof raw === 'string' ? { text: raw } : raw
        if (out.text || out.imageUrl) return { plugin: plugin.name, result: out }
      } catch (error) {
        if (ctx.signal?.aborted) throw error // пользователь остановил
        if (timeout.aborted) {
          return { plugin: plugin.name, result: { text: `⏱ ${plugin.icon} «${plugin.name}» не успел ответить. Попробуй ещё раз.` } }
        }
        console.error(`Plugin ${plugin.name} error:`, error)
      }
    }
    return null
  }

  getPlugins(): Plugin[] {
    return this.plugins
  }
}
