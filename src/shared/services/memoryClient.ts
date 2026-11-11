// src/shared/services/memoryClient.ts
// Клиент хранилища истории (главный процесс: electron/memoryService.ts).
// Вне Electron (например, в браузере при отладке) все вызовы тихо возвращают пустой результат.

import type { Message } from '@shared/types'
import { safeInvoke } from './ipcSafe'

const invoke = safeInvoke

export const memoryAPI = {
  addMessage: (message: Message) => invoke('memory:addMessage', message),

  /** Последние сообщения текущего диалога (до отметки «Очистить чат») */
  getRecent: async (limit = 40): Promise<Message[]> => (await invoke<Message[]>('memory:getRecent', limit)) ?? [],

  /** Все сообщения за период [from, to] (мс) — нужно дневнику */
  getRange: async (from: number, to: number): Promise<Message[]> =>
    (await invoke<Message[]>('memory:getRange', from, to)) ?? [],

  /** «Очистить чат»: история на диске остаётся (из неё пишется дневник), но в контекст больше не попадает */
  reset: () => invoke('memory:reset'),

  incrementAccess: (messageId: string) => invoke('memory:incrementAccess', messageId),

  search: async (query: string, limit?: number): Promise<Message[]> =>
    (await invoke<Message[]>('memory:search', query, limit)) ?? [],

  getAll: async (): Promise<Message[]> => (await invoke<Message[]>('memory:getAll')) ?? [],

  /** Полное удаление истории с диска */
  clear: () => invoke('memory:clear'),
}
