import { contextBridge, ipcRenderer } from 'electron'

// События, на которые окна могут подписываться (всё остальное — только invoke)
const EVENTS = new Set(['diary:changed', 'diary:write-request', 'diary:status', 'emotion:changed', 'lipsync:frame', 'settings:goto', 'reminders:changed'])

contextBridge.exposeInMainWorld('electronAPI', {
  invoke: (channel: string, ...args: any[]) => ipcRenderer.invoke(channel, ...args),

  /** Подписка на событие главного процесса. Возвращает функцию отписки. */
  on: (channel: string, listener: (...args: any[]) => void) => {
    if (!EVENTS.has(channel)) throw new Error(`Канал не разрешён: ${channel}`)
    const handler = (_event: unknown, ...args: any[]) => listener(...args)
    ipcRenderer.on(channel, handler)
    return () => { ipcRenderer.removeListener(channel, handler) }
  },

  // Обратная совместимость:
  minimizeWindow: () => ipcRenderer.invoke('minimize-app'),
  closeWindow: () => ipcRenderer.invoke('close-app'),
})
