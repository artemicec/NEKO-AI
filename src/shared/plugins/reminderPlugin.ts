// src/shared/plugins/reminderPlugin.ts
//
// «Напомни мне через 10 минут выпить воды» / «покажи напоминания» / «отмени все напоминания».
// Разбор фразы — reminderParse.ts (чисто), хранение и таймеры — главный процесс (electron/reminders.ts).
// Плагин отвечает за честность: если напоминание не создалось, так и говорит, а не соглашается «запомнить».

import type { Plugin, PluginContext } from '@shared/types'
import { formatWhen, parseReminderCommand, type ReminderParse } from '@shared/services/reminderParse'
import { reminderAPI, type Reminder, type ReminderClient } from '@shared/services/reminderClient'

const HINT = 'Скажи, например: «напомни через 20 минут позвонить маме» или «напомни завтра в 9 утра про встречу».'
const stem5 = (w: string) => w.toLowerCase().replace(/ё/g, 'е').slice(0, 5)

function listLine(r: Reminder, now: Date): string {
  return `• ${formatWhen(r.at, now)} — ${r.text}`
}

export class ReminderPlugin implements Plugin {
  name = 'Напоминания'
  description = 'Напомню о чём-нибудь через время или в нужный час: «напомни через 10 минут…»'
  icon = '⏰'

  constructor(
    private readonly client: ReminderClient = reminderAPI,
    private readonly clock: () => Date = () => new Date()
  ) {}

  /** Берёмся только за то, что распознали как команду напоминаний */
  matches(input: string): boolean {
    try { return parseReminderCommand(input, this.clock()) !== null } catch { return false }
  }

  async execute(input: string, ctx?: PluginContext): Promise<string> {
    const now = this.clock()
    const cmd: ReminderParse | null = parseReminderCommand(input, now)
    if (!cmd) return ''

    // Выключено в настройках — говорим прямо; молча отдать фразу модели нельзя: она бы «пообещала» напомнить и ничего не сделала
    if (ctx?.settings.remindersEnabled === false) {
      return '⏰ Напоминания выключены в настройках («Интерфейс» → «Напоминания»), поэтому напоминание не создано. Включи их и повтори просьбу.'
    }

    switch (cmd.kind) {
      case 'incomplete': {
        if (cmd.reason === 'no-time') return `⏰ Когда напомнить? ${HINT}`
        if (cmd.reason === 'no-text') return `⏰ О чём напомнить? ${HINT}`
        if (cmd.reason === 'past') return '⏰ Это время уже прошло. Назови время в будущем — например, «через 20 минут» или «завтра в 9 утра».'
        return '⏰ Так далеко вперёд (больше года) я напоминания не ставлю.'
      }

      case 'add': {
        const r = await this.client.add(cmd.text, cmd.at).catch(() => null)
        if (!r) {
          return '⏰ Не получилось поставить напоминание: либо их уже слишком много (максимум 100), либо нет связи с приложением. Напоминание НЕ создано.'
        }
        return `⏰ Хорошо, напомню ${cmd.label}: ${cmd.text}`
      }

      case 'list': {
        const items = await this.client.list().catch(() => [] as Reminder[])
        if (!items.length) return '⏰ Сейчас никаких напоминаний нет.'
        const shown = items.slice(0, 10).map((r) => listLine(r, now))
        const more = items.length > 10 ? `\n…и ещё ${items.length - 10}` : ''
        return `⏰ Напоминания (${items.length}):\n${shown.join('\n')}${more}`
      }

      case 'clear': {
        const n = await this.client.clear().catch(() => 0)
        return n ? `⏰ Готово, все напоминания отменены (${n}).` : '⏰ Отменять нечего — напоминаний нет.'
      }

      case 'cancel': {
        const items = await this.client.list().catch(() => [] as Reminder[])
        if (!items.length) return '⏰ Отменять нечего — напоминаний нет.'
        const words = cmd.query.split(/\s+/).filter((w) => w.length >= 3).map(stem5)
        const hits = words.length
          ? items.filter((r) => words.every((w) => r.text.toLowerCase().replace(/ё/g, 'е').includes(w)))
          : items.length === 1 ? items : []
        if (hits.length === 1) {
          const ok = await this.client.cancel(hits[0].id).catch(() => false)
          return ok ? `⏰ Отменено: ${hits[0].text} (было ${formatWhen(hits[0].at, now)}).` : '⏰ Не получилось отменить напоминание.'
        }
        if (hits.length > 1) return `⏰ Подходит несколько, уточни:\n${hits.slice(0, 6).map((r) => listLine(r, now)).join('\n')}`
        return `⏰ Такого напоминания не нашлось. Сейчас стоят:\n${items.slice(0, 6).map((r) => listLine(r, now)).join('\n')}`
      }
    }
  }
}
