// src/shared/services/corsHosts.ts
// Облачные API (OpenAI, Anthropic, ElevenLabs…) не присылают CORS-заголовков для страниц Electron, поэтому главный
// процесс подставляет их сам, но только для известных хостов (electron/cors.ts). Адрес «своего» сервера
// пользователь вводит вручную — перед первым запросом сообщаем его главному процессу.

import { safeInvoke } from './ipcSafe'

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/i
const announced = new Set<string>()

/** Просит главный процесс разрешить запросы к хосту из этого адреса. Ошибки не бросает (нет Electron — ничего не делает) */
export async function allowCloudHost(rawUrl: string): Promise<void> {
  try {
    const host = new URL(rawUrl).hostname
    if (!host || LOCAL.test(host) || announced.has(host)) return
    announced.add(host)
    await safeInvoke('net:allow-host', rawUrl)
  } catch { /* некорректный адрес — запрос и так упадёт с понятной ошибкой */ }
}

/** Только для тестов */
export function _resetAnnouncedHosts() { announced.clear() }
