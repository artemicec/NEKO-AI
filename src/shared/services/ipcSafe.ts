// src/shared/services/ipcSafe.ts
//
// Всё, что уходит в главный процесс, должно быть простыми данными. Объекты из store Vue — это Proxy,
// а IPC Электрона их не клонирует: «An object could not be cloned». Поэтому на границе IPC делаем чистую копию.

/** Глубокая «чистая» копия (JSON-данные: объекты, массивы, строки, числа, булевы; undefined пропадает) */
export function toPlain<T>(value: T): T {
  if (value === undefined || value === null || typeof value !== 'object') return value
  return JSON.parse(JSON.stringify(value)) as T
}

/**
 * Вызов IPC: аргументы чистятся, а любой сбой (в том числе синхронный — так падает мост Электрона)
 * превращается в отклонённый Promise, чтобы вызывающий мог его перехватить, а не получить исключение посреди ответа.
 */
export function safeInvoke<T = any>(channel: string, ...args: any[]): Promise<T | undefined> {
  try {
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined
    if (!api) return Promise.resolve(undefined)
    return api.invoke(channel, ...args.map((a) => toPlain(a)))
  } catch (e) {
    return Promise.reject(e)
  }
}
