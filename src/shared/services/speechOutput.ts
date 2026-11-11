// src/shared/services/speechOutput.ts
//
// Очередь озвучки. Предложения приходят по мере генерации ответа, поэтому NEKO начинает говорить,
// пока модель ещё пишет конец реплики. Для Chatterbox аудио следующих предложений
// запрашивается заранее (параллельно с проигрыванием текущего) — так же для ElevenLabs и Cartesia.

import { useSettingsStore } from '@shared/stores/settingsStore'
import { currentPersona } from '@shared/persona'
import { cleanForSpeech, hasSpeakable } from './speechText'
import { analyzeAudio, MouthBroadcaster, MouthPlayer, TextMouthTrack, type Mouth } from './lipSync'
import { safeInvoke } from './ipcSafe'
import type { TtsEngine } from '@shared/types'
import {
  TtsError, cloudConfigured, describeTtsError, synthCartesia, synthElevenLabs,
  type CloudTtsConfig, type CloudTtsEngine,
} from './cloudTts'

export interface SpeechConfig {
  enabled: boolean
  engine: TtsEngine
  rate: number
  pitch: number
  voiceName: string
  chatterboxEndpoint: string
  chatterboxVoice: string
  /** Параметры выразительности Chatterbox (см. voicePresets.ts) */
  exaggeration: number
  cfgWeight: number
  temperature: number
  /** Какой по счёту из подходящих голосов брать при автоподборе: у ARIA — второй, чтобы голоса различались */
  voiceRank: number
  /** Липсинк: двигать рот аватара в такт речи (по умолчанию включён) и коэффициент размаха */
  lipSync?: boolean
  lipGain?: number
  /** Язык озвучки для облачных движков: 'ru', 'en'… */
  ttsLanguage?: string
  /** Облачные движки: ключ, модель и ID голоса ЭТОЙ персоны */
  elevenlabs?: { apiKey: string; endpoint: string; model: string; voiceId: string }
  cartesia?: { apiKey: string; model: string; voiceId: string; endpoint?: string }
}

const isCloud = (e: TtsEngine): e is CloudTtsEngine => e === 'elevenlabs' || e === 'cartesia'

/** После ошибки движок «остывает»: ошибки ключа/голоса/лимита не лечатся повторами, сеть и сервер — быстрее */
const COOLDOWN_SHORT_MS = 60_000
const COOLDOWN_LONG_MS = 300_000
const REQUEST_TIMEOUT_MS = 30_000

/** Даже при размахе 100 % полностью раскрытый рот («аа» = 1,0) у большинства моделей выглядит как крик */
const MOUTH_BASE_GAIN = 0.85

interface Item {
  text: string
  audio?: Promise<AudioBuffer | null>
}

/**
 * Выбор голоса: по имени из настроек, иначе русский женский, иначе любой русский.
 * rank > 0 берёт следующий подходящий голос (если он есть) — так NEKO и ARIA по умолчанию звучат по-разному.
 */
export function pickVoice(voices: { name: string; lang: string }[], wanted: string, rank = 0) {
  if (wanted) {
    const exact = voices.find((v) => v.name === wanted)
    if (exact) return exact
  }
  const ru = voices.filter((v) => v.lang.toLowerCase().startsWith('ru'))
  const female = ru.filter((v) => /irina|svetlana|milena|katya|alena|female|жен/i.test(v.name))
  const pool = female.length ? female : ru
  return pool[Math.min(Math.max(0, rank), Math.max(0, pool.length - 1))]
}

export class SpeechOutput {
  private queue: Item[] = []
  private running = false
  private epoch = 0
  private audioCtx: AudioContext | null = null
  private source: AudioBufferSourceNode | null = null
  /** До какого времени движок считается недоступным (после ошибки говорим системным голосом) */
  private downUntil: Partial<Record<TtsEngine, number>> = {}
  private ctrl = new AbortController()
  private _lastError = ''
  private errorListeners = new Set<(message: string) => void>()
  private listeners = new Set<(speaking: boolean) => void>()
  private _speaking = false
  private mouthListeners = new Set<(m: Mouth | null) => void>()
  private mouth = new MouthPlayer((m) => this.emitMouth(m))
  private mouthGain = MOUTH_BASE_GAIN

  constructor(private getCfg: () => SpeechConfig) {}

  /** Кадры формы рта (null — рот закрыт). Подписываются аватары: ARIA напрямую, NEKO — через главный процесс */
  onMouth(cb: (m: Mouth | null) => void): () => void {
    this.mouthListeners.add(cb)
    return () => this.mouthListeners.delete(cb)
  }

  private emitMouth(m: Mouth | null) {
    if (!this.mouthListeners.size) return
    const out = m ? (m.map((v) => Math.min(1, Math.max(0, v * this.mouthGain))) as Mouth) : null
    this.mouthListeners.forEach((cb) => { try { cb(out) } catch { /* подписчик не должен ронять озвучку */ } })
  }

  private startMouth(source: Parameters<MouthPlayer['start']>[0], clock: () => number, cfg: SpeechConfig) {
    if (cfg.lipSync === false) return
    this.mouthGain = MOUTH_BASE_GAIN * Math.min(1.5, Math.max(0.3, cfg.lipGain ?? 1))
    this.mouth.start(source, clock)
  }

  get speaking() { return this._speaking }

  /** Последняя ошибка облачной озвучки (пусто — всё хорошо) */
  get lastError() { return this._lastError }

  /** Подписка на ошибки облачной озвучки (текст по-русски, без ключа) */
  onError(cb: (message: string) => void): () => void {
    this.errorListeners.add(cb)
    return () => this.errorListeners.delete(cb)
  }

  private reportError(engine: TtsEngine, message: string, long: boolean) {
    this.downUntil[engine] = Date.now() + (long ? COOLDOWN_LONG_MS : COOLDOWN_SHORT_MS)
    this._lastError = message
    this.errorListeners.forEach((cb) => { try { cb(message) } catch { /* подписчик не должен ронять озвучку */ } })
  }

  onSpeakingChange(cb: (speaking: boolean) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private setSpeaking(v: boolean) {
    if (this._speaking === v) return
    this._speaking = v
    this.listeners.forEach((cb) => cb(v))
  }

  enqueue(sentence: string) {
    this.push(sentence)
  }

  private push(sentence: string): Item | null {
    const cfg = this.getCfg()
    if (!cfg.enabled) return null
    const text = cleanForSpeech(sentence)
    if (!hasSpeakable(text)) return null

    const item: Item = { text }
    if (cfg.engine !== 'browser' && Date.now() > (this.downUntil[cfg.engine] ?? 0)) {
      // предзагрузка, пока играет предыдущее; нет настроек облака — сразу системный голос
      if (cfg.engine === 'chatterbox') item.audio = this.fetchChatterbox(text, cfg)
      else if (isCloud(cfg.engine) && this.cloudConfig(cfg.engine, cfg)) item.audio = this.fetchCloud(cfg.engine, text, cfg)
    }
    this.queue.push(item)
    void this.run()
    return item
  }

  /**
   * Проверка голоса из настроек: сбрасывает «остывание» после прошлых ошибок и возвращает текст ошибки облака
   * (пустая строка — звук получен или используется системный голос).
   */
  async test(sentence: string): Promise<string> {
    this.stop()
    this.downUntil = {}
    this._lastError = ''
    const cfg = this.getCfg()
    if (isCloud(cfg.engine) && !this.cloudConfig(cfg.engine, cfg)) {
      return `Не указан API-ключ или ID голоса ${cfg.engine === 'elevenlabs' ? 'ElevenLabs' : 'Cartesia'}.`
    }
    const item = this.push(sentence)
    if (item?.audio) await item.audio
    return this._lastError
  }

  stop() {
    this.epoch++
    this.ctrl.abort() // отменяем запросы к облаку, которые ещё в пути
    this.ctrl = new AbortController()
    this.queue = []
    this.running = false
    try { window.speechSynthesis?.cancel() } catch { /* нет синтезатора */ }
    try { this.source?.stop() } catch { /* уже остановлен */ }
    this.source = null
    this.mouth.stop()
    this.setSpeaking(false)
  }

  private async run() {
    if (this.running) return
    this.running = true
    const epoch = this.epoch
    this.setSpeaking(true)
    try {
      while (this.queue.length && epoch === this.epoch) {
        const item = this.queue.shift()!
        await this.play(item, epoch)
      }
    } finally {
      if (epoch === this.epoch) {
        this.running = false
        this.mouth.stop()
        this.setSpeaking(false)
      }
    }
  }

  private async play(item: Item, epoch: number) {
    const cfg = this.getCfg()
    if (item.audio) {
      const buffer = await item.audio
      if (epoch !== this.epoch) return
      if (buffer) return this.playBuffer(buffer, cfg)
    }
    await this.speakBrowser(item.text, cfg, epoch)
  }

  private async fetchChatterbox(text: string, cfg: SpeechConfig): Promise<AudioBuffer | null> {
    try {
      const res = await fetch(`${cfg.chatterboxEndpoint.replace(/\/+$/, '')}/audio/speech`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: text,
          voice: cfg.chatterboxVoice,
          response_format: 'wav',
          speed: cfg.rate,
          exaggeration: cfg.exaggeration,
          cfg_weight: cfg.cfgWeight,
          temperature: cfg.temperature,
        }),
        signal: AbortSignal.timeout(30_000),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await this.decode(await res.arrayBuffer())
    } catch (e) {
      // Chatterbox недоступен — минуту говорим системным голосом, чтобы не ждать таймаутов
      this.downUntil.chatterbox = Date.now() + COOLDOWN_SHORT_MS
      console.warn('Chatterbox TTS недоступен, переключаюсь на системный голос:', e)
      return null
    }
  }

  private async decode(data: ArrayBuffer): Promise<AudioBuffer> {
    this.audioCtx ??= new AudioContext()
    if (this.audioCtx.state === 'suspended') await this.audioCtx.resume().catch(() => {})
    return await this.audioCtx.decodeAudioData(data)
  }

  /** Настройки облачного движка для запроса; null — ключ или голос не заданы */
  private cloudConfig(engine: CloudTtsEngine, cfg: SpeechConfig): CloudTtsConfig | null {
    const c = engine === 'elevenlabs' ? cfg.elevenlabs : cfg.cartesia
    if (!c) return null
    const out: CloudTtsConfig = {
      apiKey: c.apiKey, model: c.model, voiceId: c.voiceId,
      language: cfg.ttsLanguage || 'ru', speed: cfg.rate,
      endpoint: engine === 'elevenlabs' ? cfg.elevenlabs?.endpoint : cfg.cartesia?.endpoint,
    }
    return cloudConfigured(out) ? out : null
  }

  /** Озвучка ElevenLabs / Cartesia → AudioBuffer (дальше — тот же путь, что у Chatterbox, включая липсинк по звуку) */
  private async fetchCloud(engine: CloudTtsEngine, text: string, cfg: SpeechConfig): Promise<AudioBuffer | null> {
    const conf = this.cloudConfig(engine, cfg)
    if (!conf) return null
    const signal = AbortSignal.any([this.ctrl.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
    try {
      const data = await (engine === 'elevenlabs' ? synthElevenLabs : synthCartesia)(text, conf, signal)
      return await this.decode(data)
    } catch (e) {
      if (this.ctrl.signal.aborted || (e instanceof TtsError && e.kind === 'aborted')) return null // озвучку остановили — не ошибка
      const long = e instanceof TtsError && ['config', 'auth', 'quota', 'voice', 'language'].includes(e.kind)
      const message = describeTtsError(e, engine) || 'Облачная озвучка недоступна.'
      console.warn(`Облачная озвучка недоступна, говорю системным голосом: ${message}`)
      this.reportError(engine, message, long)
      return null
    }
  }

  private playBuffer(buffer: AudioBuffer, cfg: SpeechConfig): Promise<void> {
    return new Promise((resolve) => {
      const ctx = this.audioCtx!
      const src = ctx.createBufferSource()
      src.buffer = buffer
      src.connect(ctx.destination)
      src.onended = () => { if (this.source === src) this.source = null; this.mouth.stop(); resolve() }
      this.source = src
      src.start()

      // Рот — по самому звуку: время берём у аудиоконтекста (за вычетом задержки вывода), поэтому он не «уплывает»
      if (cfg.lipSync !== false) {
        try {
          const startAt = ctx.currentTime
          const latency = (ctx as AudioContext & { outputLatency?: number }).outputLatency || ctx.baseLatency || 0
          this.startMouth(analyzeAudio(buffer), () => ctx.currentTime - startAt - latency, cfg)
        } catch (e) { console.warn('Липсинк: не удалось разобрать звук', e) }
      }
    })
  }

  private speakBrowser(text: string, cfg: SpeechConfig, epoch: number): Promise<void> {
    return new Promise((resolve) => {
      const synth = window.speechSynthesis
      if (!synth || epoch !== this.epoch) return resolve()

      const u = new SpeechSynthesisUtterance(text)
      u.lang = 'ru-RU'
      u.rate = cfg.rate
      u.pitch = cfg.pitch
      const voice = pickVoice(synth.getVoices(), cfg.voiceName, cfg.voiceRank)
      if (voice) u.voice = voice as SpeechSynthesisVoice

      // Страховка: в Chromium onend иногда не приходит
      const guard = setTimeout(() => { this.mouth.stop(); resolve() }, Math.max(4000, text.length * 140))
      const done = () => { clearTimeout(guard); this.mouth.stop(); resolve() }
      u.onend = done
      u.onerror = done

      // Системный голос звука не отдаёт — двигаем рот по тексту: темп из rate, подстройка по границам слов
      // (события boundary приходят не у всех голосов; без них рот идёт по расчётному темпу)
      if (cfg.lipSync !== false) {
        const track = new TextMouthTrack(text, cfg.rate)
        let t0 = performance.now()
        let shift = 0
        const clock = () => (performance.now() - t0) / 1000 + shift
        this.startMouth(track, clock, cfg)
        u.onstart = () => { t0 = performance.now(); shift = 0 } // без задержки запуска голоса
        u.onboundary = (e: SpeechSynthesisEvent) => {
          if (e.name && e.name !== 'word') return
          shift = track.timeAtChar(e.charIndex) - (performance.now() - t0) / 1000
        }
      }
      synth.speak(u)
    })
  }
}

/** Общий экземпляр: настройки читаются в момент каждой фразы, поэтому изменения применяются сразу */
export const speechOutput = new SpeechOutput(() => {
  const s = useSettingsStore().settings
  const persona = currentPersona()
  const v = s.voices[persona]
  return {
    enabled: s.enableVoiceOutput,
    engine: s.ttsEngine,
    rate: v.rate,
    pitch: v.pitch,
    voiceName: v.voiceName,
    chatterboxEndpoint: s.chatterboxEndpoint,
    chatterboxVoice: v.chatterboxVoice,
    ttsLanguage: s.ttsLanguage,
    elevenlabs: { apiKey: s.elevenlabsApiKey, endpoint: s.elevenlabsEndpoint, model: s.elevenlabsModel, voiceId: v.elevenlabsVoiceId },
    cartesia: { apiKey: s.cartesiaApiKey, model: s.cartesiaModel, voiceId: v.cartesiaVoiceId },
    exaggeration: v.exaggeration,
    cfgWeight: v.cfgWeight,
    temperature: v.temperature,
    voiceRank: persona === 'aria' ? 1 : 0,
    lipSync: s.lipSync,
    lipGain: s.lipSyncGain,
  }
})

// Аватар NEKO живёт в отдельном окне: кадры формы рта уходят туда через главный процесс (ARIA подписывается напрямую).
// Рассылка только для NEKO — иначе голос ARIA двигал бы рот NEKO.
{
  const broadcaster = new MouthBroadcaster((frame) => { void safeInvoke('lipsync:frame', frame).catch(() => {}) })
  speechOutput.onMouth((m) => { if (currentPersona() === 'neko') broadcaster.push(m) })
}
