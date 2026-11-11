// src/shared/services/lipSync.ts
//
// Липсинк: форма рта в такт озвучке. Никакой графики и Electron здесь нет — только чистая логика,
// поэтому всё покрыто тестами (tests/lipsync.test.ts).
//
// Форма рта — пять весов VRM-гласных [aa, ih, ou, ee, oh], каждый 0..1 (как у выражений VRM 1.0;
// у моделей VRM 0.x three-vrm переименовывает a/i/u/e/o сам).
//
// Откуда берётся форма рта:
//  • Chatterbox отдаёт готовый звук → analyzeAudio(): громкость по окнам 10 мс даёт раскрытие рта,
//    грубая «частота» (центроид по разностному сигналу) — форму: закрытые гласные / о-э / а, шипящие — почти закрыто.
//    Это эвристика, а не распознавание фонем: рот попадает в ритм речи и громкость, но не обязан точно
//    повторять каждую гласную;
//  • системный голос (speechSynthesis) звука не отдаёт → TextMouthTrack: дорожка по тексту (русские гласные,
//    смыкание на п/б/м/в/ф, паузы на знаках препинания), темп из rate, подстройка по событиям boundary.

export type Viseme = 'aa' | 'ih' | 'ou' | 'ee' | 'oh'
export const VISEMES: readonly Viseme[] = ['aa', 'ih', 'ou', 'ee', 'oh']
export type Mouth = [aa: number, ih: number, ou: number, ee: number, oh: number]

/** Предел раскрытия по каждой форме: «и» и «э» не должны раскрывать рот так же широко, как «а» */
export const VISEME_MAX: Record<Viseme, number> = { aa: 1, ih: 0.55, ou: 0.75, ee: 0.65, oh: 0.9 }

const IDX: Record<Viseme, number> = { aa: 0, ih: 1, ou: 2, ee: 3, oh: 4 }
const closed = (): Mouth => [0, 0, 0, 0, 0]
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)

/** Источник формы рта: форма в момент t (секунды от начала фразы) */
export interface MouthSource {
  readonly duration: number
  at(t: number): Mouth
}

function lerp(a: Mouth, b: Mouth, u: number): Mouth {
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, a[3] + (b[3] - a[3]) * u, a[4] + (b[4] - a[4]) * u]
}

function peak(v: Viseme, amp: number): Mouth {
  const m = closed()
  m[IDX[v]] = clamp01(VISEME_MAX[v] * amp)
  return m
}

/* ═════════════ дорожка по тексту (системный голос) ═════════════ */

const VOWELS: Record<string, Viseme> = {
  а: 'aa', я: 'aa', о: 'oh', ё: 'oh', у: 'ou', ю: 'ou', ы: 'ih', и: 'ih', э: 'ee', е: 'ee',
  a: 'aa', e: 'ee', i: 'ih', o: 'oh', u: 'ou', y: 'ih',
}
const LABIAL = new Set([...'пбмвфpbmvfw'])
const DIGIT_CYCLE: Viseme[] = ['aa', 'ee', 'oh', 'ih']

/** Время на слог при rate = 1 (секунды): русская речь ≈ 5–6 слогов в секунду */
const SYLLABLE_S = 0.17
const START_S = 0.03

interface Key { t: number; m: Mouth }
interface WordMark { charStart: number; t: number }

function pauseFor(ch: string): number {
  if (',;:'.includes(ch)) return 0.2
  if ('.!?…'.includes(ch)) return 0.38
  if ('—–'.includes(ch)) return 0.12
  return 0
}

export class TextMouthTrack implements MouthSource {
  readonly duration: number
  private keys: Key[] = []
  private words: WordMark[] = []

  constructor(text: string, rate = 1) {
    const r = Math.max(0.4, Math.min(3, Number.isFinite(rate) ? rate : 1))
    const keys = this.keys
    let t = START_S / r
    keys.push({ t: 0, m: closed() })

    const push = (time: number, m: Mouth) => {
      const last = keys[keys.length - 1]
      keys.push({ t: Math.max(time, last.t), m })
    }
    const closeAt = (time: number) => push(time, closed())

    let i = 0
    let first = true
    const n = text.length
    while (i < n) {
      const ch = text[i]
      const low = ch.toLowerCase()

      // пауза на знаках препинания: рот закрывается на всё время паузы
      const pause = pauseFor(ch)
      if (pause > 0 && !first) {
        // «...» и «?!» — одна пауза, не три
        let j = i + 1
        while (j < n && pauseFor(text[j]) > 0) j++
        const longest = Math.max(...[...text.slice(i, j)].map(pauseFor))
        closeAt(t + 0.04 / r)
        t += longest / r
        closeAt(t - 0.02 / r)
        i = j
        continue
      }

      const isLetter = /\p{L}/u.test(ch)
      const isDigit = /\p{N}/u.test(ch)
      if (!isLetter && !isDigit) { i++; continue }

      // слово = подряд идущие буквы/цифры (дефис и апостроф внутри слова не разрывают его)
      let j = i
      while (j < n && /[\p{L}\p{N}'’-]/u.test(text[j])) j++
      const word = text.slice(i, j)
      this.words.push({ charStart: i, t })

      // слоги слова: гласная + число согласных перед ней + смыкание губами
      type Unit = { v: Viseme; cons: number; labial: boolean }
      const units: Unit[] = []
      let cons = 0
      let labial = false
      let digitRun = 0
      for (const c of word.toLowerCase()) {
        if (/\p{N}/u.test(c)) {
          // число читается словами: ~1,5 слога на цифру
          const k = Math.ceil(1.5 * ++digitRun) - Math.ceil(1.5 * (digitRun - 1))
          for (let s = 0; s < k; s++) units.push({ v: DIGIT_CYCLE[(units.length) % DIGIT_CYCLE.length], cons: 0, labial: false })
          continue
        }
        const v = VOWELS[c]
        if (v) { units.push({ v, cons, labial }); cons = 0; labial = false }
        else if (/\p{L}/u.test(c)) { cons++; if (LABIAL.has(c)) labial = true }
      }

      if (units.length === 0) {
        t += 0.06 / r // «в», «к», «с» — предлог без гласной: короткая пауза в артикуляции
      }

      let prev: Mouth | null = null
      units.forEach((u, k) => {
        const dur = (SYLLABLE_S + 0.02 * Math.min(3, u.cons)) / r
        const s = t
        // небольшая неравномерность, чтобы рот не двигался как метроном (детерминированно по позиции)
        const amp = 0.72 + 0.28 * (((i + k) * 37) % 11) / 10
        const pk = peak(u.v, amp)
        if (u.labial) {
          push(s, closed()) // губы сомкнулись перед гласной (п, б, м, в, ф)
        } else if (prev) {
          push(s, lerp(prev, pk, 0.5).map((x) => x * 0.35) as Mouth)
        } else {
          push(s, pk.map((x) => x * 0.15) as Mouth)
        }
        push(s + dur * 0.5, pk)
        prev = pk
        t = s + dur
      })
      first = false
      i = j
    }

    closeAt(t + 0.05 / r)
    this.duration = keys[keys.length - 1].t
  }

  /** Когда в дорожке начинается слово, на которое указывает charIndex (для подстройки по boundary) */
  timeAtChar(charIndex: number): number {
    const idx = Math.max(0, Number.isFinite(charIndex) ? charIndex : 0)
    let t = this.words[0]?.t ?? 0
    for (const w of this.words) {
      if (w.charStart <= idx) t = w.t
      else break
    }
    return t
  }

  /** Форма рта в момент t. После конца дорожки она повторяется — пока голос ещё звучит, рот не «застывает» */
  at(t: number): Mouth {
    if (!(t >= 0) || this.keys.length < 2) return closed()
    if (this.duration > 0.4 && t > this.duration) t = t % this.duration
    const keys = this.keys
    let lo = 0
    let hi = keys.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (keys[mid].t <= t) lo = mid; else hi = mid
    }
    const a = keys[lo]
    const b = keys[hi]
    if (t <= a.t) return a.m.slice() as Mouth
    if (t >= b.t) return b.m.slice() as Mouth
    const u = (t - a.t) / (b.t - a.t)
    return lerp(a.m, b.m, u * u * (3 - 2 * u))
  }
}

/* ═════════════ дорожка по звуку (Chatterbox) ═════════════ */

export interface AudioLike {
  sampleRate: number
  length: number
  getChannelData(channel: number): Float32Array
}

const FLOOR_DB = -58 // тише — цифровая тишина/шум, рот закрыт
const HOP_S = 0.01
const WIN_S = 0.024

export class AudioMouthTrack implements MouthSource {
  readonly duration: number
  constructor(private frames: Float32Array, private count: number, private hop: number) {
    this.duration = count * hop
  }

  at(t: number): Mouth {
    if (!(t >= 0) || this.count === 0) return closed()
    const f = t / this.hop
    const i = Math.floor(f)
    if (i >= this.count) return closed()
    const u = f - i
    const j = Math.min(this.count - 1, i + 1)
    const out = closed()
    for (let k = 0; k < 5; k++) out[k] = this.frames[i * 5 + k] * (1 - u) + this.frames[j * 5 + k] * u
    return out
  }
}

/** Приблизительная «яркость» окна в Гц: по отношению энергии разностного сигнала к энергии сигнала */
function centroidHz(diffEnergy: number, energy: number, sampleRate: number): number {
  if (energy <= 0) return 0
  const ratio = Math.sqrt(diffEnergy / energy)
  return (sampleRate / Math.PI) * Math.asin(Math.min(1, ratio / 2))
}

/**
 * Для гласных этот центроид в основном следит за первой формантой, то есть за раскрытием челюсти
 * (по синтетическим гласным: и/у/ы ≈ 280–340 Гц, э/о ≈ 500–540, а ≈ 720), у шипящих он выше 3 кГц.
 */
export function vowelMix(hz: number): Mouth {
  const q = clamp01((hz - 280) / (740 - 280))
  let m: Mouth
  if (q < 0.5) {
    const u = q / 0.5 // закрытые (и/у) → средние (о/э)
    m = [0, 0.5 * (1 - u), 0.5 * (1 - u), 0.4 * u, 0.6 * u]
  } else {
    const u = (q - 0.5) / 0.5 // средние → «а»
    m = [u, 0, 0, 0.4 * (1 - u), 0.6 * (1 - u)]
  }
  return m
}

export function analyzeAudio(buf: AudioLike, gain = 1): AudioMouthTrack {
  const sr = buf.sampleRate
  const x = buf.length > 0 ? buf.getChannelData(0) : new Float32Array(0)
  const hopN = Math.max(1, Math.round(sr * HOP_S))
  const winN = Math.max(2, Math.round(sr * WIN_S))
  const count = x.length ? Math.ceil(x.length / hopN) : 0

  const db = new Float32Array(count)
  const hz = new Float32Array(count)
  for (let f = 0; f < count; f++) {
    const start = f * hopN
    const end = Math.min(x.length, start + winN)
    let e = 0
    let de = 0
    for (let k = start; k < end; k++) {
      const s = x[k]
      e += s * s
      if (k > start) { const d = s - x[k - 1]; de += d * d }
    }
    const len = Math.max(1, end - start)
    db[f] = Math.max(-120, 20 * Math.log10(Math.sqrt(e / len) + 1e-9))
    hz[f] = centroidHz(de, e, sr)
  }

  // уровень «громко»: 95-й процентиль по окнам, которые вообще слышны
  const audible: number[] = []
  for (let f = 0; f < count; f++) if (db[f] > FLOOR_DB) audible.push(db[f])
  const frames = new Float32Array(count * 5)
  if (audible.length) {
    audible.sort((a, b) => a - b)
    const top = audible[Math.min(audible.length - 1, Math.floor(audible.length * 0.95))]

    // раскрытие: от (top − 32 дБ) до (top − 6 дБ); мягкое сглаживание 3 окнами, чтобы рот не дрожал
    const open = new Float32Array(count)
    for (let f = 0; f < count; f++) {
      open[f] = db[f] <= FLOOR_DB ? 0 : clamp01((db[f] - (top - 32)) / 26)
    }
    for (let f = 0; f < count; f++) {
      const o = 0.25 * open[Math.max(0, f - 1)] + 0.5 * open[f] + 0.25 * open[Math.min(count - 1, f + 1)]
      if (o <= 0.01) continue
      const o2 = Math.pow(o, 0.8) * gain

      // гласная или шипящая: шипящие — рот почти закрыт, зубы чуть видны
      const fric = clamp01((hz[f] - 1500) / 1500)
      const v = vowelMix(hz[f])
      for (let k = 0; k < 5; k++) {
        const base = (1 - fric) * v[k] * o2
        frames[f * 5 + k] = clamp01(base * VISEME_MAX[VISEMES[k]])
      }
      frames[f * 5 + IDX.ih] = clamp01(frames[f * 5 + IDX.ih] + fric * 0.35 * o2 * VISEME_MAX.ih)
    }
  }
  return new AudioMouthTrack(frames, count, HOP_S)
}

/* ═════════════ воспроизведение, сглаживание, рассылка ═════════════ */

type Cancel = () => void
export type Scheduler = (fn: () => void, ms: number) => Cancel

const defaultScheduler: Scheduler = (fn, ms) => {
  const id = setInterval(fn, ms)
  return () => clearInterval(id)
}

/** Гоняет источник формы рта по часам (время воспроизведения) и отдаёт кадры; stop() закрывает рот */
export class MouthPlayer {
  private cancel: Cancel | null = null
  private source: MouthSource | null = null
  private clock: (() => number) | null = null

  constructor(
    private emit: (m: Mouth | null) => void,
    private schedule: Scheduler = defaultScheduler,
    private intervalMs = 33,
  ) {}

  get active() { return this.cancel !== null }

  start(source: MouthSource, clock: () => number) {
    this.halt()
    this.source = source
    this.clock = clock
    this.cancel = this.schedule(() => this.tick(), this.intervalMs)
    this.tick()
  }

  /** Подменить часы на лету (подстройка по boundary) */
  setClock(clock: () => number) { this.clock = clock }

  private tick() {
    if (!this.source || !this.clock) return
    let t = 0
    try { t = this.clock() } catch { t = 0 }
    this.emit(this.source.at(t))
  }

  private halt() {
    this.cancel?.()
    this.cancel = null
    this.source = null
    this.clock = null
  }

  stop() {
    const was = this.cancel !== null
    this.halt()
    if (was) this.emit(null)
  }
}

/**
 * Сглаживание на стороне аватара: рот раскрывается быстро и закрывается чуть медленнее.
 * Сторожок: нет кадров дольше watchdogMs (окно чата закрыли, голос оборвался) → рот сам закрывается.
 */
export class MouthFilter {
  private cur: Mouth = closed()
  private target: Mouth = closed()
  private lastFrameAt = -Infinity

  constructor(private watchdogMs = 300, private attack = 28, private release = 16) {}

  set(frame: readonly number[] | null | undefined, nowMs: number) {
    if (!frame || frame.length < 5) { this.target = closed(); this.lastFrameAt = nowMs; return }
    for (let k = 0; k < 5; k++) this.target[k] = clamp01(Number(frame[k]) || 0)
    this.lastFrameAt = nowMs
  }

  /** Шаг сглаживания; возвращает текущие веса (копия). Для закрытого рта — нули */
  step(deltaSec: number, nowMs: number): Mouth {
    const stale = nowMs - this.lastFrameAt > this.watchdogMs
    for (let k = 0; k < 5; k++) {
      const goal = stale ? 0 : this.target[k]
      const rate = goal > this.cur[k] ? this.attack : this.release
      const a = 1 - Math.exp(-Math.max(0, deltaSec) * rate)
      let v = this.cur[k] + (goal - this.cur[k]) * a
      if (Math.abs(v - goal) < 0.004) v = goal
      this.cur[k] = v
    }
    return this.cur.slice() as Mouth
  }

  get isClosed() { return this.cur.every((v) => v === 0) }
}

/**
 * Рассылка кадров в другое окно (аватар NEKO живёт в отдельном окне): не чаще ~30 раз в секунду,
 * почти одинаковые кадры пропускаются (но не дольше keepAliveMs — иначе сторожок закроет рот),
 * закрытие рта уходит сразу.
 */
export class MouthBroadcaster {
  private lastAt = -Infinity
  private last: Mouth | null = null
  private lastWasNull = true

  constructor(
    private send: (frame: number[] | null) => void,
    private now: () => number = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
    private minIntervalMs = 30,
    private keepAliveMs = 120,
    private epsilon = 0.02,
  ) {}

  push(m: Mouth | null) {
    const t = this.now()
    if (!m) {
      if (!this.lastWasNull) { this.lastWasNull = true; this.last = null; this.lastAt = t; this.send(null) }
      return
    }
    if (t - this.lastAt < this.minIntervalMs) return
    if (this.last && t - this.lastAt < this.keepAliveMs) {
      let diff = 0
      for (let k = 0; k < 5; k++) diff = Math.max(diff, Math.abs(m[k] - this.last[k]))
      if (diff < this.epsilon) return
    }
    this.lastAt = t
    this.last = m.slice() as Mouth
    this.lastWasNull = false
    this.send(m.map((v) => Math.round(clamp01(v) * 100) / 100))
  }
}

/** Проверка кадра, пришедшего по IPC: 5 конечных чисел 0..1 либо null (закрыть рот) */
export function sanitizeFrame(f: unknown): number[] | null {
  if (!Array.isArray(f) || f.length !== 5) return null
  const out = f.map((v) => (typeof v === 'number' && Number.isFinite(v) ? clamp01(v) : 0))
  return out
}
