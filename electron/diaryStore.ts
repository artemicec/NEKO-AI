// electron/diaryStore.ts
//
// Хранилище дневника NEKO: userData/diary/diary.json (записи) + userData/diary/images/* (фото).
// Запись атомарная (tmp → rename) с резервной копией diary.json.bak.
// Типы продублированы из src/shared/types (папка electron/ собирается отдельным tsc и не должна
// импортировать файлы из src/, иначе изменится структура dist-electron).

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

export const EMOTION_LABELS = [
  'joy', 'affection', 'playful', 'smug', 'embarrassed', 'annoyed',
  'sad', 'worried', 'curious', 'sleepy', 'excited', 'neutral',
] as const
type EmotionLabel = (typeof EMOTION_LABELS)[number]
const PHOTO_KINDS = ['selfie', 'generated', 'user', 'card'] as const
type PhotoKind = (typeof PHOTO_KINDS)[number]

export interface DiaryPhoto { id: string; file: string; kind: PhotoKind; caption: string; prompt?: string; createdAt: number }
export interface DiaryThought { about: string; thought: string; emotion: EmotionLabel }
export interface DiaryEntry {
  id: string
  date: string
  createdAt: number
  updatedAt: number
  title: string
  text: string
  mood: { label: EmotionLabel; intensity: number; summary: string }
  thoughts: DiaryThought[]
  photos: DiaryPhoto[]
  emotionStats: { label: EmotionLabel; count: number }[]
  range: { from: number; to: number }
  messageCount: number
  source: 'auto' | 'manual'
  model?: string
}

const IMAGE_FILE = /^[\w.-]{1,120}\.(png|jpe?g|webp)$/i
const ENTRY_ID = /^[\w.-]{1,64}$/
const MAX_IMAGE_BYTES = 25 * 1024 * 1024

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '')
const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const label = (v: unknown): EmotionLabel => ((EMOTION_LABELS as readonly string[]).includes(v as string) ? (v as EmotionLabel) : 'neutral')

/** Приводит запись, пришедшую из окна, к безопасному виду. Возвращает null, если это не запись. */
export function sanitizeEntry(raw: any, now = Date.now()): DiaryEntry | null {
  if (!raw || typeof raw !== 'object') return null
  if (typeof raw.id !== 'string' || !ENTRY_ID.test(raw.id)) return null
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : ''
  if (!date) return null

  const photos: DiaryPhoto[] = (Array.isArray(raw.photos) ? raw.photos : [])
    .filter((p: any) => p && typeof p.file === 'string' && IMAGE_FILE.test(p.file))
    .slice(0, 12)
    .map((p: any): DiaryPhoto => ({
      id: ENTRY_ID.test(p.id ?? '') ? p.id : crypto.randomUUID(),
      file: p.file,
      kind: (PHOTO_KINDS as readonly string[]).includes(p.kind) ? p.kind : 'user',
      caption: str(p.caption, 300),
      prompt: typeof p.prompt === 'string' ? p.prompt.slice(0, 1000) : undefined,
      createdAt: num(p.createdAt, now),
    }))

  const thoughts: DiaryThought[] = (Array.isArray(raw.thoughts) ? raw.thoughts : [])
    .filter((t: any) => t && typeof t.thought === 'string' && t.thought.trim())
    .slice(0, 30)
    .map((t: any): DiaryThought => ({ about: str(t.about, 300), thought: str(t.thought, 600), emotion: label(t.emotion) }))

  const stats = (Array.isArray(raw.emotionStats) ? raw.emotionStats : [])
    .filter((s: any) => s && typeof s.count === 'number')
    .slice(0, 12)
    .map((s: any) => ({ label: label(s.label), count: Math.max(0, Math.round(s.count)) }))

  return {
    id: raw.id,
    date,
    createdAt: num(raw.createdAt, now),
    updatedAt: now,
    title: str(raw.title, 160) || 'Без названия',
    text: str(raw.text, 20000),
    mood: {
      label: label(raw.mood?.label),
      intensity: Math.max(0, Math.min(1, num(raw.mood?.intensity, 0.5))),
      summary: str(raw.mood?.summary, 300),
    },
    thoughts,
    photos,
    emotionStats: stats,
    range: { from: num(raw.range?.from, 0), to: num(raw.range?.to, 0) },
    messageCount: Math.max(0, Math.round(num(raw.messageCount, 0))),
    source: raw.source === 'manual' ? 'manual' : 'auto',
    model: typeof raw.model === 'string' ? raw.model.slice(0, 100) : undefined,
  }
}

interface DiaryFile { version: 1; entries: DiaryEntry[] }

export class DiaryStore {
  private entries: DiaryEntry[]
  private chain: Promise<void> = Promise.resolve()
  readonly imagesDir: string
  private file: string

  constructor(private dir: string) {
    this.imagesDir = path.join(dir, 'images')
    this.file = path.join(dir, 'diary.json')
    fs.mkdirSync(this.imagesDir, { recursive: true })
    this.entries = this.load()
  }

  private tryRead(p: string): DiaryEntry[] | null {
    try {
      const data = JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, '')) as DiaryFile
      if (!Array.isArray(data.entries)) return null
      return data.entries.map((e) => sanitizeEntry(e, e?.updatedAt ?? Date.now())).filter((e): e is DiaryEntry => !!e)
    } catch {
      return null
    }
  }

  private load(): DiaryEntry[] {
    return this.tryRead(this.file) ?? this.tryRead(this.file + '.bak') ?? []
  }

  private persist(): Promise<void> {
    const snapshot: DiaryFile = { version: 1, entries: this.entries }
    this.chain = this.chain
      .then(async () => {
        const tmp = this.file + '.tmp'
        await fs.promises.writeFile(tmp, JSON.stringify(snapshot), 'utf8')
        await fs.promises.copyFile(this.file, this.file + '.bak').catch(() => {})
        await fs.promises.rename(tmp, this.file)
      })
      .catch((e) => console.error('diary write failed:', e))
    return this.chain
  }

  /** Новые записи сверху */
  list(): DiaryEntry[] {
    return [...this.entries].sort((a, b) => b.createdAt - a.createdAt)
  }

  get(id: string): DiaryEntry | null {
    return this.entries.find((e) => e.id === id) ?? null
  }

  /** Конец последнего охваченного записями периода — дальше от него дневник «читает» новые сообщения */
  lastCoveredTime(): number {
    return this.entries.reduce((m, e) => Math.max(m, e.range.to), 0)
  }

  async save(raw: unknown): Promise<DiaryEntry | null> {
    const entry = sanitizeEntry(raw)
    if (!entry) return null
    const i = this.entries.findIndex((e) => e.id === entry.id)
    if (i >= 0) {
      entry.createdAt = this.entries[i].createdAt // дата создания не меняется при правках
      this.entries[i] = entry
    } else {
      this.entries.push(entry)
    }
    await this.persist()
    return entry
  }

  async remove(id: string): Promise<boolean> {
    const i = this.entries.findIndex((e) => e.id === id)
    if (i < 0) return false
    const [removed] = this.entries.splice(i, 1)
    await this.persist()
    const stillUsed = new Set(this.entries.flatMap((e) => e.photos.map((p) => p.file)))
    for (const p of removed.photos) if (!stillUsed.has(p.file)) await this.removeImage(p.file)
    return true
  }

  /** Сохраняет картинку из data URL и возвращает имя файла */
  async addImage(dataUrl: string): Promise<string> {
    const m = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl)
    if (!m) throw new Error('Неподдерживаемый формат изображения')
    const buf = Buffer.from(m[2], 'base64')
    if (buf.length === 0 || buf.length > MAX_IMAGE_BYTES) throw new Error('Недопустимый размер изображения')
    const ext = m[1] === 'jpeg' ? 'jpg' : m[1]
    const name = `img_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}.${ext}`
    await fs.promises.writeFile(path.join(this.imagesDir, name), buf)
    return name
  }

  async removeImage(file: string): Promise<void> {
    const p = this.imagePath(file)
    if (p) await fs.promises.unlink(p).catch(() => {})
  }

  /** Безопасный путь к файлу картинки (только внутри images/) либо null */
  imagePath(file: string): string | null {
    const name = path.basename(file || '')
    if (name !== file || !IMAGE_FILE.test(name)) return null
    const p = path.join(this.imagesDir, name)
    return fs.existsSync(p) ? p : null
  }

  flush(): Promise<void> {
    return this.chain
  }
}
