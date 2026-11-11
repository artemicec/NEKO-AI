// src/shared/services/animationScheduler.ts
// Расписание случайных анимаций аватара (NEKO и ARIA). Чистый модуль: без three/Vue, таймеры и «случайность» подставляются.
//
// Раньше следующая анимация выбиралась по таймеру от СТАРТА предыдущей (раз в 7 с), а клипы длиннее — поэтому
// анимации шли встык и отвлекали. Теперь цикл такой:
//   стандартная поза (пауза) → один клип → плавное возвращение в стандартную позу → снова пауза, и так далее.
// Пауза отсчитывается от КОНЦА клипа, у неё есть случайный разброс, чтобы движения не выглядели «по часам».

export const MIN_PAUSE_MS = 3000
/** Разброс паузы: от 60% до 140% от заданной */
const JITTER_MIN = 0.6
const JITTER_SPAN = 0.8
/** Если аватар занят (говорит, окно скрыто) — перепроверяем через столько */
export const BUSY_RECHECK_MS = 2000
/** Запас сверх длительности клипа, после которого считаем, что клип закончился (на случай потерянного события) */
const WATCHDOG_SLACK_S = 3

/** Длительность паузы в мс: среднее ± случайный разброс, но не короче MIN_PAUSE_MS */
export function nextPauseMs(avgSeconds: number, rand: () => number = Math.random): number {
  const avg = Number.isFinite(avgSeconds) && avgSeconds > 0 ? avgSeconds : 30
  const r = Math.min(1, Math.max(0, rand()))
  return Math.max(MIN_PAUSE_MS, Math.round(avg * 1000 * (JITTER_MIN + JITTER_SPAN * r)))
}

/** Следующий клип: любой, кроме только что игравшего (если вариантов больше одного) */
export function pickNext(names: readonly string[], last: string | null, rand: () => number = Math.random): string | null {
  if (!names.length) return null
  const pool = names.length > 1 && last ? names.filter((n) => n !== last) : [...names]
  const i = Math.min(pool.length - 1, Math.floor(Math.min(1, Math.max(0, rand())) * pool.length))
  return pool[i]
}

export interface SchedulerTimers {
  set(fn: () => void, ms: number): unknown
  clear(handle: unknown): void
}

const realTimers: SchedulerTimers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
}

export interface SchedulerHooks {
  /** Клипы, которые можно проигрывать как «анимацию» (без стандартной позы) */
  gestures(): string[]
  /** Запускает клип один раз. Возвращает его длительность в секундах, либо null, если запустить не вышло */
  play(name: string): number | null
  /** Плавно вернуться в стандартную позу */
  rest(): void
  /** true — сейчас не время для анимации (аватар говорит, окно скрыто…) */
  busy?(): boolean
}

export type SchedulerState = 'stopped' | 'resting' | 'playing'

export class AnimationScheduler {
  private state: SchedulerState = 'stopped'
  private pauseSeconds = 30
  private last: string | null = null
  private timer: unknown = null
  private watchdog: unknown = null

  constructor(
    private hooks: SchedulerHooks,
    private rand: () => number = Math.random,
    private timers: SchedulerTimers = realTimers
  ) {}

  get running(): boolean { return this.state !== 'stopped' }
  get playing(): boolean { return this.state === 'playing' }

  /** Запуск. Повторный вызов только обновляет паузу — без рывка и без сброса идущей анимации */
  start(pauseSeconds: number) {
    if (this.state !== 'stopped') return this.setPause(pauseSeconds)
    this.pauseSeconds = pauseSeconds
    this.state = 'resting'
    this.arm(nextPauseMs(this.pauseSeconds, this.rand))
  }

  /** Новая средняя пауза. Если сейчас идёт ожидание — оно пересчитывается; играющий клип не трогаем */
  setPause(pauseSeconds: number) {
    if (pauseSeconds === this.pauseSeconds) return
    this.pauseSeconds = pauseSeconds
    if (this.state === 'resting') this.arm(nextPauseMs(this.pauseSeconds, this.rand))
  }

  /** Остановка. Если клип ещё играет — аватар плавно возвращается в стандартную позу */
  stop() {
    this.clearTimers()
    const wasPlaying = this.state === 'playing'
    this.state = 'stopped'
    if (wasPlaying) this.hooks.rest()
  }

  /** Клип доиграл (событие микшера) */
  onGestureFinished() {
    if (this.state !== 'playing') return
    this.clearTimers()
    this.state = 'resting'
    this.hooks.rest()
    this.arm(nextPauseMs(this.pauseSeconds, this.rand))
  }

  private arm(ms: number) {
    if (this.timer !== null) this.timers.clear(this.timer)
    this.timer = this.timers.set(() => this.fire(), ms)
  }

  private clearTimers() {
    if (this.timer !== null) this.timers.clear(this.timer)
    if (this.watchdog !== null) this.timers.clear(this.watchdog)
    this.timer = null
    this.watchdog = null
  }

  private fire() {
    this.timer = null
    if (this.state !== 'resting') return
    if (this.hooks.busy?.()) return this.arm(BUSY_RECHECK_MS)

    const name = pickNext(this.hooks.gestures(), this.last, this.rand)
    const duration = name ? this.hooks.play(name) : null
    if (!name || duration === null) return this.arm(nextPauseMs(this.pauseSeconds, this.rand))

    this.last = name
    this.state = 'playing'
    const ms = (Math.max(0.5, duration) + WATCHDOG_SLACK_S) * 1000
    this.watchdog = this.timers.set(() => { this.watchdog = null; this.onGestureFinished() }, ms)
  }
}
