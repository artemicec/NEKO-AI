// src/shared/services/whisper.ts
//
// Голосовой ввод через Whisper: локальный сервер с OpenAI-совместимым API (POST …/audio/transcriptions).
// Подходят speaches / faster-whisper-server, whisper.cpp server, LocalAI и т. п. — всё, что принимает такой запрос.
// В этом файле нет DOM: запись с микрофона — в voiceRecorder.ts, а здесь то, что можно проверить тестами:
// ресемплинг и WAV, детектор конца фразы, запрос к серверу, чистка «галлюцинаций» Whisper на тишине.

export const WHISPER_RATE = 16_000

export interface WhisperConfig {
  /** База API («http://localhost:8000/v1») или полный адрес метода (оканчивается на /inference или /transcriptions) */
  endpoint: string
  model: string
  /** 'ru', 'en'… или 'auto' (язык не передаётся, сервер определяет сам) */
  language: string
  /** Подсказка для распознавания имён («Неко, NEKO»). Пусто — не передаётся */
  prompt?: string
}

export type WhisperErrorKind = 'offline' | 'http' | 'empty' | 'other'

export class WhisperError extends Error {
  constructor(public kind: WhisperErrorKind, message: string, public status?: number) {
    super(message)
    this.name = 'WhisperError'
  }
}

/* ───────────────────────── Звук: ресемплинг и WAV ───────────────────────── */

/** Понижение частоты дискретизации усреднением по окну (достаточно для речи; без «звона» от простого прореживания) */
export function resampleMono(input: Float32Array, from: number, to: number = WHISPER_RATE): Float32Array {
  if (!(from > 0) || !(to > 0)) throw new RangeError('bad sample rate')
  if (from === to || input.length === 0) return input.slice()
  const ratio = from / to
  const outLen = Math.max(1, Math.floor(input.length / ratio))
  const out = new Float32Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const start = i * ratio
    const end = Math.min(input.length, (i + 1) * ratio)
    const a = Math.floor(start)
    const b = Math.max(a + 1, Math.ceil(end))
    let sum = 0
    let wsum = 0
    for (let j = a; j < b && j < input.length; j++) {
      // вес — доля окна, которую занимает отсчёт (краевые отсчёты учитываются частично)
      const w = Math.min(j + 1, end) - Math.max(j, start)
      if (w <= 0) continue
      sum += input[j] * w
      wsum += w
    }
    out[i] = wsum > 0 ? sum / wsum : 0
  }
  return out
}

/** WAV: PCM 16 бит, моно. Именно такой формат принимают все серверы Whisper (whisper.cpp без ffmpeg — только его) */
export function encodeWav(samples: Float32Array, rate: number = WHISPER_RATE): ArrayBuffer {
  const dataLen = samples.length * 2
  const buf = new ArrayBuffer(44 + dataLen)
  const v = new DataView(buf)
  const str = (off: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)) }
  str(0, 'RIFF'); v.setUint32(4, 36 + dataLen, true); str(8, 'WAVE')
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true) // PCM
  v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true)
  v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  str(36, 'data'); v.setUint32(40, dataLen, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return buf
}

export const rms = (frame: Float32Array): number => {
  if (frame.length === 0) return 0
  let sum = 0
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i]
  return Math.sqrt(sum / frame.length)
}

/* ───────────────────────── Конец фразы (VAD по громкости) ───────────────────────── */

export interface VadOptions {
  /** Сколько тишины после речи считать концом фразы */
  silenceMs: number
  /** Сколько ждать начала речи, прежде чем сдаться */
  noSpeechMs?: number
  /** Предел длины записи */
  maxMs?: number
  /** Речь короче этого — случайный шум (щелчок, стук) */
  minSpeechMs?: number
}

export type VadEvent =
  | { type: 'speech-start'; atMs: number }
  | { type: 'end'; reason: 'silence' | 'no-speech' | 'max'; atMs: number }

/**
 * Простейший детектор: порог — над уровнем шума, который измеряется в первые 250 мс и затем медленно подстраивается.
 * Кормится кадрами из микрофона в порядке поступления; время считает по числу отсчётов (а не по часам) — поэтому тестируется.
 */
export class EnergyVad {
  private t = 0                // мс с начала записи
  private floor = 0.004
  private calibMs = 0
  private calibSum = 0
  private speaking = false
  private speechAcc = 0
  private silenceAcc = 0
  private speechStart = -1
  private ended = false
  private readonly o: Required<VadOptions>

  constructor(private sampleRate: number, opts: VadOptions) {
    this.o = { noSpeechMs: 7000, maxMs: 30_000, minSpeechMs: 160, ...opts }
  }

  get isSpeaking() { return this.speaking }
  /** Когда началась речь (мс от начала записи); -1 — пока не началась */
  get speechStartMs() { return this.speechStart }
  get elapsedMs() { return this.t }
  get threshold() { return Math.max(this.floor * 3, 0.012) }

  feed(frame: Float32Array): VadEvent | null {
    if (this.ended) return null
    const ms = (frame.length / this.sampleRate) * 1000
    const level = rms(frame)
    this.t += ms

    if (this.calibMs < 250) {
      this.calibMs += ms
      this.calibSum += level * ms
      this.floor = Math.max(0.002, this.calibSum / this.calibMs)
      // речь, начавшаяся прямо с кнопки, не должна «задрать» уровень шума: калибровку пропускаем, если уж слишком громко
      if (level > 0.08) { this.floor = 0.004; this.calibMs = 250 }
      return this.checkLimits()
    }

    const loud = level > this.threshold
    if (!this.speaking) {
      if (loud) {
        this.speechAcc += ms
        if (this.speechAcc >= this.o.minSpeechMs) {
          this.speaking = true
          this.silenceAcc = 0
          this.speechStart = Math.max(0, this.t - this.speechAcc)
          return { type: 'speech-start', atMs: this.speechStart }
        }
      } else {
        this.speechAcc = 0
        this.floor = this.floor * 0.97 + level * 0.03 // шум в комнате меняется — порог тоже
      }
      return this.checkLimits()
    }

    // гистерезис: пауза — это заметно тише порога, а не «чуть ниже»
    if (level < this.threshold * 0.75) this.silenceAcc += ms
    else this.silenceAcc = 0
    if (this.silenceAcc >= this.o.silenceMs) { this.ended = true; return { type: 'end', reason: 'silence', atMs: this.t } }
    return this.checkLimits()
  }

  private checkLimits(): VadEvent | null {
    if (this.t >= this.o.maxMs) { this.ended = true; return { type: 'end', reason: 'max', atMs: this.t } }
    if (!this.speaking && this.t >= this.o.noSpeechMs) { this.ended = true; return { type: 'end', reason: 'no-speech', atMs: this.t } }
    return null
  }
}

/* ───────────────────────── Чистка текста ───────────────────────── */

/**
 * Whisper на тишине и шуме «досочиняет» фразы из субтитров, на которых учился. Такой «ввод» отправлять нельзя:
 * отбрасываем, если текст целиком состоит из известных артефактов (или повторяет подсказку, или это одни знаки).
 */
const HALLUCINATIONS = [
  /^продолжение следует/, /^(редактор )?субтитры?( сделал| создавал| подготовил| предоставил)?/, /^корректор( |$)/,
  /^(большое )?спасибо за (просмотр|внимание)\.?$/, /^подписывайтесь на (мой )?канал/, /^ставьте лайки/,
  /^до (новых )?встреч(и|ах)?\.?$/, /^приятного просмотра/, /^thanks? for watching/, /^thank you( very much)?\.?$/,
  /^subtitles? (by|made)/, /amara\.org/, /^www\.\S+\.\S+$/, /^(так|ну|эм+|м+|а+|э+|угу|хм+)\.*$/,
]

const normalize = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}\s.]/gu, ' ').replace(/\s+/g, ' ').trim()

export function cleanTranscript(text: string, prompt = ''): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (!t || !/[\p{L}\p{N}]/u.test(t)) return ''
  const n = normalize(t)
  if (prompt && n === normalize(prompt)) return ''
  if (HALLUCINATIONS.some((re) => re.test(n))) return ''
  return t
}

/* ───────────────────────── Запрос к серверу ───────────────────────── */

export function whisperUrl(endpoint: string): string {
  const e = endpoint.trim().replace(/\/+$/, '')
  return /\/(inference|transcriptions?)$/i.test(e) ? e : `${e}/audio/transcriptions`
}

export interface TranscribeOptions {
  signal?: AbortSignal
  fetchFn?: (input: string, init?: RequestInit) => Promise<Response>
  timeoutMs?: number
}

/** Отправляет WAV на сервер и возвращает распознанный текст (уже очищенный от «галлюцинаций») */
export async function transcribe(wav: ArrayBuffer, cfg: WhisperConfig, opts: TranscribeOptions = {}): Promise<string> {
  const form = new FormData()
  form.append('file', new Blob([wav], { type: 'audio/wav' }), 'speech.wav')
  form.append('model', cfg.model)
  form.append('response_format', 'json')
  form.append('temperature', '0')
  if (cfg.language && cfg.language !== 'auto') form.append('language', cfg.language)
  if (cfg.prompt) form.append('prompt', cfg.prompt)

  const timeout = AbortSignal.timeout(opts.timeoutMs ?? 60_000)
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout
  const f = opts.fetchFn ?? ((u: string, i?: RequestInit) => fetch(u, i))

  let res: Response
  try {
    res = await f(whisperUrl(cfg.endpoint), { method: 'POST', body: form, signal })
  } catch (e) {
    if (opts.signal?.aborted) throw e
    if (timeout.aborted) throw new WhisperError('offline', 'Сервер Whisper не ответил вовремя')
    throw new WhisperError('offline', (e as Error)?.message || 'fetch failed')
  }
  if (!res.ok) {
    let detail = ''
    try { detail = (await res.text()).replace(/\s+/g, ' ').slice(0, 160) } catch { /* тело не нужно */ }
    throw new WhisperError('http', `HTTP ${res.status}${detail ? `: ${detail}` : ''}`, res.status)
  }

  const raw = await res.text()
  let text = raw
  try {
    const j = JSON.parse(raw)
    text = typeof j?.text === 'string' ? j.text : Array.isArray(j?.segments) ? j.segments.map((s: any) => s?.text ?? '').join(' ') : ''
  } catch { /* сервер вернул чистый текст (response_format=text) — берём как есть */ }
  return cleanTranscript(text, cfg.prompt)
}

/** Проверка «сервер жив и адрес верный»: отправляет полсекунды тишины; не важно, что он «услышал», важно, что ответил 200 */
export async function whisperAvailable(cfg: WhisperConfig, opts: TranscribeOptions = {}): Promise<void> {
  await transcribe(encodeWav(new Float32Array(WHISPER_RATE / 2)), { ...cfg, prompt: '' }, { ...opts, timeoutMs: opts.timeoutMs ?? 20_000 })
}

/** Человеческое объяснение ошибки для подсказки в чате */
export function describeWhisperError(e: unknown, endpoint: string): string {
  if (e instanceof WhisperError) {
    if (e.kind === 'offline') return `Сервер Whisper не отвечает (${endpoint}). Запусти его или выбери «Браузер» в настройках голоса.`
    if (e.kind === 'http') {
      if (e.status === 404) return `Сервер Whisper ответил 404: проверь адрес (${endpoint}) и имя модели в настройках голоса.`
      return `Сервер Whisper вернул ошибку: ${e.message}`
    }
  }
  return `Не удалось распознать речь: ${(e as Error)?.message ?? e}`
}
