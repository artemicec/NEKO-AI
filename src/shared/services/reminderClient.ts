// src/shared/services/reminderClient.ts
// Обёртка над IPC напоминаний (главный процесс: electron/reminders.ts).

import { safeInvoke } from './ipcSafe'

export interface Reminder {
  id: string
  text: string
  /** Когда напомнить, мс с эпохи */
  at: number
  createdAt: number
  /** Сработало с опозданием: приложение было закрыто или компьютер спал */
  missed?: boolean
}

/** Что нужно плагину (отдельный тип — в тестах подставляется простая подделка) */
export interface ReminderClient {
  add(text: string, at: number): Promise<Reminder | null>
  list(): Promise<Reminder[]>
  cancel(id: string): Promise<boolean>
  clear(): Promise<number>
}

const api = () => (typeof window !== 'undefined' ? window.electronAPI : undefined)

export const reminderAPI = {
  add: async (text: string, at: number): Promise<Reminder | null> => (await safeInvoke<Reminder | null>('reminders:add', text, at)) ?? null,
  list: async (): Promise<Reminder[]> => (await safeInvoke<Reminder[]>('reminders:list')) ?? [],
  cancel: async (id: string): Promise<boolean> => !!(await safeInvoke<boolean>('reminders:cancel', id)),
  clear: async (): Promise<number> => (await safeInvoke<number>('reminders:clear')) ?? 0,

  /** Сработавшие и ещё не закрытые (для окна-напоминания) */
  fired: async (): Promise<Reminder[]> => (await safeInvoke<Reminder[]>('reminders:fired')) ?? [],
  dismiss: async (id: string): Promise<boolean> => !!(await safeInvoke<boolean>('reminders:dismiss', id)),
  dismissAll: async (): Promise<number> => (await safeInvoke<number>('reminders:dismiss-all')) ?? 0,
  snooze: async (id: string, minutes: number): Promise<Reminder | null> => (await safeInvoke<Reminder | null>('reminders:snooze', id, minutes)) ?? null,

  onChanged: (cb: () => void): (() => void) => api()?.on('reminders:changed', cb) ?? (() => {}),
}
