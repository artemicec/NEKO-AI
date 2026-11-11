// electron/reminders.ts
//
// Напоминания живут в главном процессе: окна чата можно закрыть, а напоминание должно сработать.
// Хранится в userData/reminders.json (запись атомарная: tmp → rename). Один таймер на ближайшее напоминание, не больше 30 с:
// после сна компьютера таймеры могут опоздать, и так мы замечаем это не позже чем через 30 с после пробуждения.
// Опоздавшее больше чем на минуту помечается «пропущено» (missed) — окно скажет об этом честно.
// Никаких импортов Electron — класс проверяется тестами с подменой часов и таймеров.

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

export interface Reminder {
  id: string
  text: string
  /** Когда напомнить, мс с эпохи */
  at: number
  createdAt: number
  /** Сработало с опозданием (приложение было закрыто или компьютер спал) */
  missed?: boolean
}

export interface ReminderDeps {
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
  /** Напоминание сработало (его надо показать) */
  onFire: (r: Reminder) => void
  /** Список изменился (добавили/отменили/сработало/закрыли) */
  onChange?: () => void
}

export const MAX_PENDING = 100
export const MAX_TEXT = 300
export const MAX_AHEAD_MS = 366 * 86_400_000
const MAX_TICK_MS = 30_000
const MISSED_AFTER_MS = 60_000
const SNOOZE_MIN = 1
const SNOOZE_MAX = 24 * 60

export class ReminderService {
  private pending: Reminder[] = []
  private firedQueue: Reminder[] = []
  private timer: unknown = null
  private readonly now: () => number
  private readonly setTimer: (fn: () => void, ms: number) => unknown
  private readonly clearTimer: (h: unknown) => void

  constructor(private readonly file: string, private readonly deps: ReminderDeps) {
    this.now = deps.now ?? Date.now
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
    this.clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))
  }

  /* ───────────── запуск ───────────── */

  /** Читает файл, запускает таймер; незакрытые и просроченные напоминания показываются сразу */
  load(): void {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as { pending?: unknown; fired?: unknown }
      this.pending = sanitizeList(raw.pending)
      this.firedQueue = sanitizeList(raw.fired)
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        // битый файл не затираем молча: оставляем копию, чтобы пользователь мог посмотреть
        try { fs.copyFileSync(this.file, `${this.file}.corrupt-${this.now()}`) } catch { /* ignore */ }
      }
      this.pending = []
      this.firedQueue = []
    }
    for (const r of this.firedQueue) this.deps.onFire(r) // не закрытые в прошлый раз показываем снова
    this.tick()
    if (this.firedQueue.length) this.deps.onChange?.()
  }

  dispose(): void {
    if (this.timer !== null) this.clearTimer(this.timer)
    this.timer = null
  }

  /* ───────────── API ───────────── */

  add(text: unknown, at: unknown): Reminder | null {
    const t = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT) : ''
    const when = typeof at === 'number' && Number.isFinite(at) ? Math.round(at) : NaN
    const now = this.now()
    if (!t || Number.isNaN(when)) return null
    if (when < now - 1000 || when > now + MAX_AHEAD_MS) return null
    if (this.pending.length >= MAX_PENDING) return null
    const r: Reminder = { id: crypto.randomBytes(6).toString('hex'), text: t, at: Math.max(when, now), createdAt: now }
    this.pending.push(r)
    this.save()
    this.schedule()
    this.deps.onChange?.()
    return { ...r }
  }

  /** Ожидающие, по времени */
  list(): Reminder[] {
    return [...this.pending].sort((a, b) => a.at - b.at).map((r) => ({ ...r }))
  }

  cancel(id: unknown): boolean {
    const before = this.pending.length
    this.pending = this.pending.filter((r) => r.id !== id)
    if (this.pending.length === before) return false
    this.save()
    this.schedule()
    this.deps.onChange?.()
    return true
  }

  clear(): number {
    const n = this.pending.length
    if (!n) return 0
    this.pending = []
    this.save()
    this.schedule()
    this.deps.onChange?.()
    return n
  }

  /** Сработавшие и ещё не закрытые пользователем */
  fired(): Reminder[] {
    return this.firedQueue.map((r) => ({ ...r }))
  }

  dismiss(id: unknown): boolean {
    const before = this.firedQueue.length
    this.firedQueue = this.firedQueue.filter((r) => r.id !== id)
    if (this.firedQueue.length === before) return false
    this.save()
    this.deps.onChange?.()
    return true
  }

  dismissAll(): number {
    const n = this.firedQueue.length
    if (!n) return 0
    this.firedQueue = []
    this.save()
    this.deps.onChange?.()
    return n
  }

  /** «Отложить на N минут»: закрывает сработавшее и создаёт такое же заново */
  snooze(id: unknown, minutes: unknown): Reminder | null {
    const m = Math.round(Number(minutes))
    if (!Number.isFinite(m) || m < SNOOZE_MIN || m > SNOOZE_MAX) return null
    const r = this.firedQueue.find((x) => x.id === id)
    if (!r) return null
    if (this.pending.length >= MAX_PENDING) return null
    this.firedQueue = this.firedQueue.filter((x) => x.id !== id)
    const next: Reminder = { id: crypto.randomBytes(6).toString('hex'), text: r.text, at: this.now() + m * 60_000, createdAt: this.now() }
    this.pending.push(next)
    this.save()
    this.schedule()
    this.deps.onChange?.()
    return { ...next }
  }

  /* ───────────── внутреннее ───────────── */

  /** Запускает всё, что уже пора. Публичный: тесты (и пробуждение компьютера) могут дёрнуть его вручную */
  tick(): void {
    const now = this.now()
    const due = this.pending.filter((r) => r.at <= now).sort((a, b) => a.at - b.at)
    if (due.length) {
      this.pending = this.pending.filter((r) => r.at > now)
      for (const r of due) {
        const fired: Reminder = now - r.at > MISSED_AFTER_MS ? { ...r, missed: true } : { ...r }
        this.firedQueue.push(fired)
      }
      this.save()
      for (const r of this.firedQueue.slice(-due.length)) {
        try { this.deps.onFire({ ...r }) } catch { /* окно не открылось — напоминание всё равно останется в списке «не закрытых» */ }
      }
      this.deps.onChange?.()
    }
    this.schedule()
  }

  private schedule(): void {
    if (this.timer !== null) this.clearTimer(this.timer)
    this.timer = null
    if (!this.pending.length) return
    const next = Math.min(...this.pending.map((r) => r.at))
    const delay = Math.min(MAX_TICK_MS, Math.max(0, next - this.now())) + 5
    this.timer = this.setTimer(() => { this.timer = null; this.tick() }, delay)
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, pending: this.pending, fired: this.firedQueue }), 'utf8')
      fs.renameSync(tmp, this.file)
    } catch (e) {
      console.warn('Напоминания: не удалось сохранить файл', e)
    }
  }
}

function sanitizeList(raw: unknown): Reminder[] {
  if (!Array.isArray(raw)) return []
  const out: Reminder[] = []
  const seen = new Set<string>()
  for (const x of raw.slice(0, MAX_PENDING * 2)) {
    if (!x || typeof x !== 'object') continue
    const r = x as Record<string, unknown>
    const id = typeof r.id === 'string' && /^[\w-]{1,32}$/.test(r.id) ? r.id : ''
    const text = typeof r.text === 'string' ? r.text.slice(0, MAX_TEXT) : ''
    const at = typeof r.at === 'number' && Number.isFinite(r.at) ? r.at : NaN
    if (!id || !text.trim() || Number.isNaN(at) || seen.has(id)) continue
    seen.add(id)
    out.push({
      id, text, at,
      createdAt: typeof r.createdAt === 'number' && Number.isFinite(r.createdAt) ? r.createdAt : at,
      ...(r.missed === true ? { missed: true } : {}),
    })
  }
  return out
}
