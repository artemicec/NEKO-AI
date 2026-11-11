// src/neko/services/diaryClient.ts
// Обёртка над IPC дневника (главный процесс: electron/diaryStore.ts).

import type { DiaryEntry } from '@shared/types'
import type { DiaryStatus } from './diaryService'
import { safeInvoke } from '@shared/services/ipcSafe'

const api = () => (typeof window !== 'undefined' ? window.electronAPI : undefined)
const invoke = safeInvoke

export interface DiaryExportRequest {
  format: 'md' | 'pdf'
  /** Какие записи; null — все */
  ids: string[] | null
  images: boolean
}
export interface DiaryExportResult { ok: boolean; canceled?: boolean; error?: string; path?: string; count?: number; images?: number }

export const diaryAPI = {
  list: async (): Promise<DiaryEntry[]> => (await invoke<DiaryEntry[]>('diary:list')) ?? [],
  get: (id: string) => invoke<DiaryEntry | null>('diary:get', id),
  save: (entry: DiaryEntry) => invoke<DiaryEntry | null>('diary:save', entry),
  remove: async (id: string): Promise<boolean> => !!(await invoke<boolean>('diary:delete', id)),
  /** Сохраняет картинку (data URL) и возвращает имя файла */
  addImage: async (dataUrl: string): Promise<string> => {
    const file = await invoke<string>('diary:addImage', dataUrl)
    if (!file) throw new Error('Не удалось сохранить изображение')
    return file
  },
  removeImage: (file: string) => invoke('diary:removeImage', file),
  lastCovered: async (): Promise<number> => (await invoke<number>('diary:lastCoveredTime')) ?? 0,
  lastMessageTime: async (): Promise<number> => (await invoke<number>('memory:lastMessageTime')) ?? 0,

  setStatus: (s: DiaryStatus) => invoke('diary:setStatus', s),
  getStatus: async (): Promise<DiaryStatus> => (await invoke<DiaryStatus>('diary:getStatus')) ?? { state: 'idle' },
  /** Экспорт в Markdown/PDF: главный процесс сам спросит, куда сохранить */
  export: async (req: DiaryExportRequest): Promise<DiaryExportResult> =>
    (await invoke<DiaryExportResult>('diary:export', { format: req.format, ids: req.ids ? [...req.ids] : null, images: req.images })) ?? { ok: false, error: 'Нет связи с приложением' },
  /** Просим главное окно написать запись прямо сейчас */
  requestWrite: async (): Promise<boolean> => !!(await invoke<boolean>('diary:requestWrite')),

  /** URL картинки для <img>; отдаётся протоколом neko-diary:// из userData/diary/images */
  imageUrl: (file: string) => `neko-diary://img/${encodeURIComponent(file)}`,

  onChanged: (cb: () => void) => api()?.on('diary:changed', cb) ?? (() => {}),
  onStatus: (cb: (s: DiaryStatus) => void) => api()?.on('diary:status', cb) ?? (() => {}),
  onWriteRequest: (cb: () => void) => api()?.on('diary:write-request', cb) ?? (() => {}),
}
