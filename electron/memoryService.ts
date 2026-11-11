// electron/memoryService.ts
//
// Постоянная история чата (раньше здесь была заглушка, которая только писала в консоль).
// Формат: по одному файлу на день, JSONL — userData/memory/<persona>/YYYY-MM-DD.jsonl.
//  • запись = одна append-операция (быстро, ничего не перечитывается и не переписывается);
//  • «Очистить чат» не удаляет историю, а кладёт в файл отметку {"type":"reset"} — контекст модели
//    начинается после неё, а дневник по-прежнему видит все сообщения;
//  • чтение «последних N» идёт с конца самых свежих файлов и не трогает старые.

import fs from 'fs'
import path from 'path'

export interface StoredMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  plugin?: string
  imageUrl?: string
  imageAlt?: string
  emotion?: { label: string; intensity: number }
  [key: string]: unknown
}

interface ResetMarker { type: 'reset'; timestamp: number }
type Line = StoredMessage | ResetMarker

const pad = (n: number) => String(n).padStart(2, '0')
export const dayKey = (ts: number): string => {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const DAY_FILE = /^\d{4}-\d{2}-\d{2}\.jsonl$/

const isReset = (l: Line): l is ResetMarker => (l as ResetMarker).type === 'reset'

function parseLines(text: string): Line[] {
  const out: Line[] = []
  for (const raw of text.replace(/^﻿/, '').split('\n')) {
    const line = raw.trim()
    if (!line) continue
    try {
      const obj = JSON.parse(line)
      if (obj && typeof obj === 'object') out.push(obj as Line)
    } catch { /* битая строка (например, обрыв записи) — пропускаем */ }
  }
  return out
}

export class MemoryService {
  private chain: Promise<void> = Promise.resolve()

  constructor(private dir: string) {
    fs.mkdirSync(dir, { recursive: true })
  }

  private fileFor(ts: number) {
    return path.join(this.dir, `${dayKey(ts)}.jsonl`)
  }

  private dayFiles(): string[] {
    try {
      return fs.readdirSync(this.dir).filter((f) => DAY_FILE.test(f)).sort()
    } catch {
      return []
    }
  }

  private readFile(name: string): Line[] {
    try {
      return parseLines(fs.readFileSync(path.join(this.dir, name), 'utf8'))
    } catch {
      return []
    }
  }

  /** Записи ставятся в цепочку, чтобы порядок строк в файле совпадал с порядком вызовов */
  private enqueue(file: string, line: Line): Promise<void> {
    const data = JSON.stringify(line) + '\n'
    this.chain = this.chain
      .then(() => fs.promises.appendFile(file, data, 'utf8'))
      .catch((e) => console.error('memory write failed:', e))
    return this.chain
  }

  addMessage(message: StoredMessage): Promise<void> {
    if (!message || typeof message.content !== 'string' || typeof message.id !== 'string') return Promise.resolve()
    const ts = Number.isFinite(message.timestamp) ? message.timestamp : Date.now()
    // base64-картинки не храним
    const rec: StoredMessage = { ...message, timestamp: ts }
    if (typeof rec.imageUrl === 'string' && rec.imageUrl.startsWith('data:')) {
      delete rec.imageUrl
      rec.imageAlt = rec.imageAlt ?? '[картинка]'
    }
    return this.enqueue(this.fileFor(ts), rec)
  }

  reset(): Promise<void> {
    const now = Date.now()
    return this.enqueue(this.fileFor(now), { type: 'reset', timestamp: now })
  }

  /** Последние limit сообщений текущего диалога (после последней отметки reset), по возрастанию времени */
  getRecent(limit = 40): StoredMessage[] {
    const result: StoredMessage[] = []
    const files = this.dayFiles()
    outer: for (let i = files.length - 1; i >= 0; i--) {
      const lines = this.readFile(files[i])
      for (let j = lines.length - 1; j >= 0; j--) {
        const l = lines[j]
        if (isReset(l)) break outer
        result.push(l)
        if (result.length >= limit) break outer
      }
    }
    return result.reverse()
  }

  /** Все сообщения периода [from, to] (мс), независимо от «очисток» — для дневника */
  getRange(from: number, to: number): StoredMessage[] {
    const fromKey = dayKey(from)
    const toKey = dayKey(to)
    const out: StoredMessage[] = []
    for (const f of this.dayFiles()) {
      const key = f.slice(0, 10)
      if (key < fromKey || key > toKey) continue
      for (const l of this.readFile(f)) {
        if (isReset(l)) continue
        if (l.timestamp >= from && l.timestamp <= to) out.push(l)
      }
    }
    return out.sort((a, b) => a.timestamp - b.timestamp)
  }

  getAll(): StoredMessage[] {
    const out: StoredMessage[] = []
    for (const f of this.dayFiles()) for (const l of this.readFile(f)) if (!isReset(l)) out.push(l)
    return out
  }

  search(query: string, limit = 20): StoredMessage[] {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const out: StoredMessage[] = []
    const files = this.dayFiles()
    for (let i = files.length - 1; i >= 0 && out.length < limit; i--) {
      const lines = this.readFile(files[i])
      for (let j = lines.length - 1; j >= 0 && out.length < limit; j--) {
        const l = lines[j]
        if (!isReset(l) && l.content.toLowerCase().includes(q)) out.push(l)
      }
    }
    return out
  }

  /** Время последнего сообщения (для планировщика дневника) */
  lastMessageTime(): number {
    const files = this.dayFiles()
    for (let i = files.length - 1; i >= 0; i--) {
      const lines = this.readFile(files[i])
      for (let j = lines.length - 1; j >= 0; j--) if (!isReset(lines[j])) return (lines[j] as StoredMessage).timestamp
    }
    return 0
  }

  /** Ждёт, пока все поставленные в очередь записи попадут на диск (нужно перед выходом и в тестах) */
  flush(): Promise<void> {
    return this.chain
  }

  incrementAccess(_messageId: string): void { /* зарезервировано под «важность» воспоминаний */ }

  clear(): void {
    for (const f of this.dayFiles()) {
      try { fs.unlinkSync(path.join(this.dir, f)) } catch { /* ignore */ }
    }
  }
}

let instance: MemoryService | null = null

/** Совместимость со старым API заглушки */
export function initMemoryService(dir: string): MemoryService {
  instance = new MemoryService(dir)
  return instance
}

export function getMemoryService(): MemoryService {
  if (!instance) throw new Error('MemoryService не инициализирован')
  return instance
}
