// src/shared/services/voiceRecorder.ts
//
// Запись фразы с микрофона для Whisper: сама определяет начало и конец речи (EnergyVad), отдаёт WAV 16 кГц моно.
// Только браузерная часть (getUserMedia + Web Audio). Всё, что можно проверить без микрофона, — в whisper.ts.
//
// Используется ScriptProcessorNode: он объявлен устаревшим, но работает в любом Chromium без отдельного файла-воркера
// (а воркер из Blob-URL могут блокировать политики безопасности). Нагрузка — один буфер раз в ~85 мс.

import { EnergyVad, encodeWav, resampleMono, WHISPER_RATE, type VadOptions } from './whisper'

export type RecorderEnd = 'silence' | 'no-speech' | 'max' | 'stopped'

export interface RecordedSpeech {
  wav: ArrayBuffer
  /** Длительность записанной речи в секундах (после обрезки тишины) */
  seconds: number
  reason: RecorderEnd
}

export interface RecorderHooks {
  onSpeechStart?: () => void
  /** Громкость 0..1 примерно раз в 85 мс (для индикатора) */
  onLevel?: (level: number) => void
}

export type RecorderErrorKind = 'denied' | 'no-device' | 'other'

export class RecorderError extends Error {
  constructor(public kind: RecorderErrorKind, message: string) {
    super(message)
    this.name = 'RecorderError'
  }
}

export const recorderSupported = (): boolean =>
  typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof AudioContext !== 'undefined'

/** Тишина до начала речи, которую оставляем перед первым слогом, и после последнего (мс) */
const PRE_ROLL_MS = 300
const TAIL_MS = 250
const BUFFER = 4096

export class VoiceRecorder {
  private stream: MediaStream | null = null
  private ctx: AudioContext | null = null
  private node: ScriptProcessorNode | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private finish: ((r: RecorderEnd) => void) | null = null

  /** Идёт запись (между start() и завершением) */
  get active() { return this.finish !== null }

  /** Записывает одну фразу. Завершается по тишине, по stop() (отдаёт то, что успело записаться) или по лимитам. */
  async record(vad: VadOptions, hooks: RecorderHooks = {}): Promise<RecordedSpeech | null> {
    if (this.active) throw new Error('already recording')
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
    } catch (e) {
      const name = (e as DOMException)?.name
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        throw new RecorderError('denied', 'Нет доступа к микрофону. Разреши его в настройках Windows (Конфиденциальность → Микрофон).')
      }
      if (name === 'NotFoundError' || name === 'OverconstrainedError') throw new RecorderError('no-device', 'Микрофон не найден.')
      throw new RecorderError('other', `Не удалось включить микрофон (${name ?? e}).`)
    }

    const ctx = new AudioContext()
    this.ctx = ctx
    if (ctx.state === 'suspended') await ctx.resume().catch(() => {})
    const rate = ctx.sampleRate
    const detector = new EnergyVad(rate, vad)
    const chunks: Float32Array[] = []
    let total = 0

    const reason = await new Promise<RecorderEnd>((resolve) => {
      this.finish = resolve
      const src = ctx.createMediaStreamSource(this.stream!)
      const node = ctx.createScriptProcessor(BUFFER, 1, 1)
      this.source = src
      this.node = node
      node.onaudioprocess = (ev) => {
        const frame = new Float32Array(ev.inputBuffer.getChannelData(0)) // буфер переиспользуется — копируем
        chunks.push(frame)
        total += frame.length
        let sum = 0
        for (let i = 0; i < frame.length; i += 4) sum += frame[i] * frame[i]
        hooks.onLevel?.(Math.min(1, Math.sqrt(sum / (frame.length / 4)) * 6))
        const ev2 = detector.feed(frame)
        if (ev2?.type === 'speech-start') hooks.onSpeechStart?.()
        if (ev2?.type === 'end') resolve(ev2.reason)
      }
      src.connect(node)
      node.connect(ctx.destination) // без этого onaudioprocess в Chromium не вызывается; на выходе — тишина (outputBuffer не трогаем)
    })

    const speechStart = detector.speechStartMs
    this.release()
    if (reason === 'no-speech' || speechStart < 0) return null // речи не было

    // склеиваем и обрезаем тишину по краям (оставляя небольшой запас, чтобы не съесть первый слог)
    const all = new Float32Array(total)
    let off = 0
    for (const c of chunks) { all.set(c, off); off += c.length }
    const from = Math.max(0, Math.floor(((speechStart - PRE_ROLL_MS) / 1000) * rate))
    const endMs = reason === 'silence' ? detector.elapsedMs - Math.max(0, vad.silenceMs - TAIL_MS) : detector.elapsedMs
    const to = Math.min(all.length, Math.max(from + 1, Math.floor((endMs / 1000) * rate)))
    const speech = resampleMono(all.subarray(from, to), rate, WHISPER_RATE)
    return { wav: encodeWav(speech), seconds: speech.length / WHISPER_RATE, reason }
  }

  /** Закончить запись сейчас (то, что уже сказано, будет распознано) */
  stop() { this.finish?.('stopped') }

  private release() {
    this.finish = null
    try { this.node?.disconnect() } catch { /* уже отключён */ }
    try { this.source?.disconnect() } catch { /* уже отключён */ }
    if (this.node) this.node.onaudioprocess = null
    this.stream?.getTracks().forEach((t) => t.stop())
    void this.ctx?.close().catch(() => {})
    this.node = null; this.source = null; this.stream = null; this.ctx = null
  }
}
