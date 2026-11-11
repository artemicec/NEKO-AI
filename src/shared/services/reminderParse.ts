// src/shared/services/reminderParse.ts
//
// «Напомни мне через 10 минут выпить воды» → { текст: «Выпить воды», когда: now + 10 мин }.
// Чистый модуль без Vue/Electron. Понимает только БУДУЩЕЕ время:
//   • через N секунд/минут/часов/дней/недель/месяцев («через час», «через полчаса», «через 2 часа 30 минут», «через пару минут»);
//   • в 18:30 · в 7 утра · в 8 вечера · в 3 дня · в полдень · в полночь (ближайшее такое время);
//   • сегодня / завтра / послезавтра / в понедельник / 15 ноября — с временем или без (без — 9:00);
//   • утром / днём / вечером (9:00 / 14:00 / 19:00).
// Вопросы о прошлом («напомни, что мы обсуждали вчера?») сюда не попадают — ими занимаются «Воспоминания».
// Ещё понимает «покажи напоминания», «отмени все напоминания», «отмени напоминание про маму».

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е')
const pad = (n: number) => String(n).padStart(2, '0')

const B = '(?<![\\p{L}\\d])'
const E = '(?![\\p{L}\\d])'
const rx = (src: string) => new RegExp(src, 'iu')

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
const WEEKDAYS = ['понедельник', 'вторник', 'среду', 'четверг', 'пятницу', 'субботу', 'воскресенье']
const WEEKDAYS_NOM = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье']
const WEEKDAY_RE = ['понедельник', 'вторник', 'сред[ауы]', 'четверг', 'пятниц[уы]', 'суббот[уы]', 'воскресень[ея]']

const NUM_WORDS: Record<string, number> = {
  один: 1, одну: 1, одна: 1, два: 2, две: 2, три: 3, четыре: 4, пять: 5, шесть: 6, семь: 7, восемь: 8, девять: 9, десять: 10,
  одиннадцать: 11, двенадцать: 12, пятнадцать: 15, двадцать: 20, тридцать: 30, сорок: 40, пятьдесят: 50, шестьдесят: 60,
  пару: 2, несколько: 3, полтора: 1.5, полторы: 1.5,
}
const NUM = `(?:\\d+(?:[.,]\\d+)?|${Object.keys(NUM_WORDS).join('|')})`
const UNIT = '(?<unit>секунд\\p{L}*|сек|минут\\p{L}*|мин|час\\p{L}*|ч|день|дня|дней|недел\\p{L}*|месяц\\p{L}*)'
const UNIT_MS: [RegExp, number][] = [
  [/^сек/, 1000], [/^мин/, 60_000], [/^(час|ч$)/, 3_600_000], [/^д/, 86_400_000], [/^нед/, 7 * 86_400_000], [/^мес/, 30 * 86_400_000],
]

const MAX_AHEAD_MS = 366 * 86_400_000
const toNum = (s: string): number => (NUM_WORDS[s] ?? Number(s.replace(',', '.')))

export type ReminderParse =
  | { kind: 'add'; text: string; at: number; label: string }
  | { kind: 'incomplete'; reason: 'no-time' | 'no-text' | 'past' | 'too-far'; text: string }
  | { kind: 'list' }
  | { kind: 'clear' }
  | { kind: 'cancel'; query: string }

/* ───────────────────────── подписи ───────────────────────── */

function humanDuration(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000))
  if (s < 60) return `${s} сек`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} мин`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest ? `${h} ч ${rest} мин` : `${h} ч`
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12) // полдень: арифметика дат не боится смены времени

/** «сегодня в 18:30 (через 20 мин)», «завтра в 09:00», «16 ноября, понедельник в 10:00» */
export function formatWhen(at: number, now: Date): string {
  const d = new Date(at)
  const diffDays = Math.round((startOfDay(d).getTime() - startOfDay(now).getTime()) / 86_400_000)
  const day = diffDays === 0 ? 'сегодня' : diffDays === 1 ? 'завтра' : diffDays === 2 ? 'послезавтра'
    : `${d.getDate()} ${MONTHS[d.getMonth()]}, ${WEEKDAYS_NOM[(d.getDay() + 6) % 7]}`
  const base = `${day} в ${pad(d.getHours())}:${pad(d.getMinutes())}`
  const delta = at - now.getTime()
  return delta < 6 * 3_600_000 ? `${base} (через ${humanDuration(delta)})` : base
}

/* ───────────────────────── разбор времени ───────────────────────── */

interface Span { start: number; end: number }

/** Первое совпадение: найденный кусок затирается пробелами в work (индексы остаются прежними), чтобы остаток был «текстом» */
function take(work: { s: string; spans: Span[] }, re: RegExp): RegExpExecArray | null {
  const m = re.exec(work.s)
  if (!m) return null
  const start = m.index
  const end = start + m[0].length
  work.s = work.s.slice(0, start) + ' '.repeat(end - start) + work.s.slice(end)
  work.spans.push({ start, end })
  return m
}

/** «через …»: возвращает длительность в мс (все части складываются: «2 часа 30 минут») */
function takeDuration(work: { s: string; spans: Span[] }): number | null {
  const head = rx(`${B}через${E}\\s*`).exec(work.s)
  if (!head) return null
  let pos = head.index + head[0].length
  let total = 0
  let parts = 0
  const FIRST = rx(`^(?:(?<half>полчаса)|(?<quarter>четверть\\s+часа)|(?:(?<n>${NUM})\\s*)?${UNIT})${E}`)
  const NEXT = rx(`^\\s*(?:и\\s+)?(?<n>${NUM})\\s*${UNIT}${E}`)
  for (;;) {
    const m = (parts === 0 ? FIRST : NEXT).exec(work.s.slice(pos))
    if (!m?.groups) break
    const g = m.groups
    if (g.half) total += 30 * 60_000
    else if (g.quarter) total += 15 * 60_000
    else {
      const k = g.n ? toNum(g.n) : 1
      const unitMs = UNIT_MS.find(([re]) => re.test(g.unit))![1]
      total += k * unitMs
    }
    pos += m[0].length
    parts++
  }
  if (!parts) return null
  work.s = work.s.slice(0, head.index) + ' '.repeat(pos - head.index) + work.s.slice(pos)
  work.spans.push({ start: head.index, end: pos })
  return total
}

/** «в 18:30», «в 7 утра», «в 8 вечера», «в 3 дня», «в полдень» → { h, m } либо null */
function takeClock(work: { s: string; spans: Span[] }): { h: number; m: number } | { bad: true } | null {
  const noon = take(work, rx(`${B}в\\s+(?:(полдень)|(полночь))${E}`))
  if (noon) return noon[1] ? { h: 12, m: 0 } : { h: 0, m: 0 }
  const m = take(work, rx(`${B}(?:в|к)\\s+(\\d{1,2})(?:[:.](\\d{2})|\\s*час(?:а|ов)?(?:\\s*(\\d{2})\\s*мин\\p{L}*)?)?(?:\\s*(утра|дня|вечера|ночи))?${E}`))
  if (!m) return null
  let h = Number(m[1])
  const min = Number(m[2] ?? m[3] ?? 0)
  const part = m[4]
  if (min > 59 || h > 24) return { bad: true }
  if (part === 'утра') { if (h === 12) h = 0 }
  else if (part === 'дня') { if (h >= 1 && h <= 11) h += 12 }
  else if (part === 'вечера') { if (h >= 1 && h <= 11) h += 12 }
  else if (part === 'ночи') { if (h === 12) h = 0; else if (h >= 6 && h <= 11) h += 12 }
  if (h === 24) h = 0
  if (h > 23) return { bad: true }
  return { h, m: min }
}

type DaySpec = { kind: 'offset'; days: number } | { kind: 'weekday'; idx: number } | { kind: 'date'; day: number; month: number }

function takeDay(work: { s: string; spans: Span[] }): DaySpec | { bad: true } | null {
  let m = take(work, rx(`${B}(сегодня|послезавтра|завтра)${E}`))
  if (m) return { kind: 'offset', days: m[1] === 'сегодня' ? 0 : m[1] === 'завтра' ? 1 : 2 }
  m = take(work, rx(`${B}в(?:о)?\\s+(${WEEKDAY_RE.join('|')})${E}`))
  if (m) return { kind: 'weekday', idx: WEEKDAY_RE.findIndex((r) => new RegExp(`^${r}$`, 'iu').test(m![1])) }
  m = take(work, rx(`${B}(\\d{1,2})(?:-?го)?\\s+(${MONTHS.join('|')})${E}`))
  if (m) {
    const day = Number(m[1])
    return day >= 1 && day <= 31 ? { kind: 'date', day, month: MONTHS.indexOf(m[2]) } : { bad: true }
  }
  return null
}

const PART_OF_DAY: Record<string, number> = { утром: 9, днем: 14, вечером: 19 }

/** Текст напоминания: без «напомни мне», времени, вводных слов; с заглавной буквы */
function cleanText(original: string, spans: Span[], sameLength: boolean): string {
  let s = original
  if (sameLength) {
    const chars = s.split('')
    for (const sp of spans) for (let i = sp.start; i < sp.end; i++) chars[i] = ' '
    s = chars.join('')
  }
  s = s
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.:;!\-—–]+/, '')
    .replace(/^(?:(?:мне|нам|меня|пожалуйста)[\s,]+)+/i, '')
    .replace(/^(?:о\s+том,?\s+что|про\s+то,?\s+что|что|чтобы)(?![\p{L}\d])[\s,]*/iu, '')
    .replace(/[\s,.:;!\-—–]+$/g, '')
    .replace(/\s+(?:пожалуйста)$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return s ? s[0].toUpperCase() + s.slice(1) : ''
}

const PAST_WORDS = rx(`${B}(?:вчера|позавчера|прошл\\p{L}*|раньше|назад|ранее)${E}`)
const ADD_TRIGGER = rx(`${B}(?:напомни(?:ть|те)?|(?:поставь|создай|добавь|сделай)\\s+(?:мне\\s+)?напоминани\\p{L}*)${E}`)
const TRIGGER_STRIP = rx(`${B}(?:напомни(?:ть|те)?|(?:поставь|создай|добавь|сделай)\\s+(?:мне\\s+)?напоминани\\p{L}*)${E}(?:\\s+(?:мне|нам|пожалуйста))*`)

export function parseReminderCommand(input: string, now: Date = new Date()): ReminderParse | null {
  const original = String(input ?? '')
  if (original.length < 6 || original.length > 400) return null
  const low = norm(original)
  const sameLength = low.length === original.length

  /* управление: список / отмена */
  if (/напоминани/.test(low)) {
    const cancel = rx(`${B}(?:отмени(?:ть|те)?|удали(?:ть|те)?|убери(?:те)?|сотри|сбрось|очисти(?:ть|те)?)${E}`).test(low)
    if (cancel) {
      if (rx(`${B}(?:все|всё)${E}[^.?!]*напоминани`).test(low) || rx(`напоминани\\p{L}*\\s+(?:все|всё)${E}`).test(low)) return { kind: 'clear' }
      const q = /напоминани\p{L}*\s+(?:(?:про|о|об|на|с)\s+)?(.*)$/iu.exec(low)
      return { kind: 'cancel', query: (q?.[1] ?? '').replace(/[?.!]+$/g, '').trim() }
    }
    if (rx(`${B}(?:покажи(?:те)?|какие|список|мои|перечисли|есть\\s+ли|сколько|что\\s+у\\s+меня)${E}`).test(low) && !ADD_TRIGGER.test(low)) return { kind: 'list' }
  }

  /* создание */
  if (!ADD_TRIGGER.test(low)) return null
  if (low.includes('?') || PAST_WORDS.test(low)) return null // «напомни, что мы обсуждали вчера?» — это «Воспоминания»

  const work = { s: low, spans: [] as Span[] }
  const trig = take(work, TRIGGER_STRIP)
  // «напомни мне …» / «поставь напоминание …» — просьба точно к нам; голое «напомни …» — ещё и не вопрос о прошлом
  const explicit = !!trig && /напоминани|(?:^|\s)(?:мне|нам)(?:\s|$)/.test(trig[0])

  const duration = takeDuration(work)
  const clock = takeClock(work)
  const day = takeDay(work)
  const pod = clock ? null : take(work, rx(`${B}(утром|днем|вечером)${E}`))

  if ((clock && 'bad' in clock) || (day && 'bad' in day)) {
    return { kind: 'incomplete', reason: 'no-time', text: cleanText(original, work.spans, sameLength) }
  }

  const text = cleanText(original, work.spans, sameLength)
  const nowMs = now.getTime()
  let at: number | null = null

  if (duration !== null) {
    if (duration <= 0 || duration > MAX_AHEAD_MS) return { kind: 'incomplete', reason: duration <= 0 ? 'past' : 'too-far', text }
    at = nowMs + duration
    // «через 2 дня в 15:00» — день по длительности, время по часам
    if (clock && !('bad' in clock) && duration >= 20 * 3_600_000) {
      const d = new Date(at)
      at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), clock.h, clock.m).getTime()
    }
  } else if (clock || day || pod) {
    const hm = clock && !('bad' in clock) ? clock : { h: pod ? PART_OF_DAY[pod[1]] : 9, m: 0 }
    const today = startOfDay(now)
    let target: Date | null = null
    if (day && !('bad' in day)) {
      if (day.kind === 'offset') target = new Date(today.getFullYear(), today.getMonth(), today.getDate() + day.days, hm.h, hm.m)
      else if (day.kind === 'weekday') {
        let ahead = (day.idx - ((now.getDay() + 6) % 7) + 7) % 7
        if (ahead === 0) ahead = 7 // «в понедельник», сказанное в понедельник, — следующий
        target = new Date(today.getFullYear(), today.getMonth(), today.getDate() + ahead, hm.h, hm.m)
      } else {
        let t = new Date(now.getFullYear(), day.month, day.day, hm.h, hm.m)
        if (t.getMonth() !== day.month) return { kind: 'incomplete', reason: 'no-time', text } // 31 июня
        if (t.getTime() <= nowMs) {
          t = new Date(now.getFullYear() + 1, day.month, day.day, hm.h, hm.m)
          if (t.getMonth() !== day.month) return { kind: 'incomplete', reason: 'no-time', text }
        }
        target = t
      }
    } else {
      // только время суток: ближайшее такое
      target = new Date(today.getFullYear(), today.getMonth(), today.getDate(), hm.h, hm.m)
      if (target.getTime() <= nowMs) target = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1, hm.h, hm.m)
    }
    at = target.getTime()
    if (at <= nowMs + 1000) return { kind: 'incomplete', reason: 'past', text }
    if (at - nowMs > MAX_AHEAD_MS) return { kind: 'incomplete', reason: 'too-far', text }
  }

  if (at === null) {
    // «напомни мне позвонить маме» — просьба без времени: спросим когда. Но не «напомни, как зовут кота» (это вопрос к памяти)
    const first = text.split(/\s+/)[0]?.toLowerCase().replace(/ё/g, 'е') ?? ''
    const infinitive = /^\p{L}{3,}(?:ть|ти|чь)(?:ся|сь)?$/u.test(first)
    const question = /^(?:что|как|когда|где|кто|какой|какая|какие|какое|чем|зачем|почему|сколько|чей)$/.test(first) || (!explicit && /^(?:о|об|про)$/.test(first))
    if (question || !(explicit || infinitive)) return null
    return { kind: 'incomplete', reason: 'no-time', text }
  }
  if (!text) return { kind: 'incomplete', reason: 'no-text', text: '' }
  return { kind: 'add', text: text.slice(0, 300), at, label: formatWhen(at, now) }
}
