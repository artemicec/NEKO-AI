// src/shared/types/electron-api.d.ts
// Типы моста preload → renderer (window.electronAPI)

export {}

declare global {
  interface Window {
    electronAPI?: {
      invoke: (channel: string, ...args: any[]) => Promise<any>
      /** Подписка на событие из главного процесса; возвращает функцию отписки */
      on: (channel: string, listener: (...args: any[]) => void) => () => void
      /** Обратная совместимость */
      minimizeWindow?: () => Promise<void>
      closeWindow?: () => Promise<void>
    }
  }
}
