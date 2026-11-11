// src/neko/services/diaryScheduler.ts
// Фоновый «писатель» дневника. Запускается ТОЛЬКО в главном окне NEKO (там живёт аватар для селфи).

import type { EmotionLabel } from '@shared/types'
import { useSettingsStore } from '@shared/stores/settingsStore'
import { memoryAPI } from '@shared/services/memoryClient'
import { createProvider } from '@shared/services/aiFactory'
import { EMOTIONS } from '@shared/services/emotion'
import { generateImage, sdAvailable } from '@shared/services/imageGenService'
import { NEKO_PROMPT } from '@neko/prompt/nekoPrompt'
import { diaryAPI } from './diaryClient'
import { writeDiaryEntry, type DiaryDeps, type PhotoContext, type WriteResult } from './diaryService'
import { composeSelfie, renderMoodCard, type PhotoStyle } from './selfie'

/** То, что нужно дневнику от компонента аватара */
export interface AvatarHandle {
  /** Прозрачный PNG (data URL) с портретом аватара либо null. emotion — какое выражение лица показать */
  capture(emotion?: EmotionLabel): Promise<string | null>
}

const TICK_MS = 60_000
const FIRST_TICK_MS = 25_000
const ERROR_BACKOFF_MS = 10 * 60_000

function styleFor(ctx: PhotoContext): PhotoStyle {
  const m = EMOTIONS[ctx.entry.mood.label]
  return { color: m.color, emoji: m.emoji, label: m.ru, dateLabel: ctx.dateLabel, title: ctx.entry.title }
}

export function createDiaryDeps(getAvatar: () => AvatarHandle | null): DiaryDeps {
  const s = useSettingsStore().settings
  return {
    provider: createProvider(s),
    settings: s,
    persona: NEKO_PROMPT,

    lastCovered: () => diaryAPI.lastCovered(),
    fetchMessages: (from, to) => memoryAPI.getRange(from, to),
    saveEntry: (entry) => diaryAPI.save(entry),
    saveImage: (dataUrl) => diaryAPI.addImage(dataUrl),

    makeSelfie: async (ctx) => {
      const avatar = getAvatar()
      const png = avatar ? await avatar.capture(ctx.entry.mood.label) : null
      return png ? composeSelfie(png, styleFor(ctx)) : null
    },
    makeCard: (ctx) => renderMoodCard(styleFor(ctx)),

    makeIllustration: async (prompt, prefix) => {
      if (!(await sdAvailable(s.sdEndpoint))) return null
      return generateImage(
        prompt,
        {
          endpoint: s.sdEndpoint,
          steps: s.sdSteps,
          width: s.sdWidth,
          height: s.sdHeight,
          negativePrompt: s.sdNegativePrompt,
          stylePrompt: s.sdStylePrompt,
        },
        { prefix, translate: false }
      )
    },

    setStatus: (st) => { void diaryAPI.setStatus(st) },
  }
}

/** Пишет запись по запросу (кнопка «Написать сейчас» в окне дневника) */
export function writeNow(getAvatar: () => AvatarHandle | null): Promise<WriteResult> {
  return writeDiaryEntry(createDiaryDeps(getAvatar), { force: true })
}

/**
 * Запускает проверку раз в минуту: появились ли новые сообщения и пора ли писать.
 * Возвращает функцию остановки.
 */
export function startDiaryScheduler(getAvatar: () => AvatarHandle | null): () => void {
  const settings = useSettingsStore()
  let stopped = false
  let nextTryAt = 0

  const handle = (r: WriteResult) => {
    if (r.status === 'error') nextTryAt = Date.now() + ERROR_BACKOFF_MS
  }

  const tick = async () => {
    if (stopped) return
    const s = settings.settings
    if (!s.diaryEnabled || !s.diaryAuto || Date.now() < nextTryAt) return
    try {
      // дешёвая проверка до всякой работы: есть ли вообще что-то новое
      const [last, covered] = await Promise.all([diaryAPI.lastMessageTime(), diaryAPI.lastCovered()])
      if (!last || last <= covered) return
      handle(await writeDiaryEntry(createDiaryDeps(getAvatar)))
    } catch (e) {
      console.warn('Планировщик дневника:', e)
    }
  }

  const interval = setInterval(tick, TICK_MS)
  const first = setTimeout(tick, FIRST_TICK_MS)

  const off = diaryAPI.onWriteRequest(async () => {
    if (!settings.settings.diaryEnabled) return
    const r = await writeNow(getAvatar)
    handle(r)
    if (r.status === 'skipped' && r.reason === 'no-messages') {
      void diaryAPI.setStatus({ state: 'error', message: 'Нам ещё не о чем писать — поболтай со мной, а потом приходи 💙' })
    } else if (r.status === 'skipped' && r.reason === 'not-yet') {
      void diaryAPI.setStatus({ state: 'error', message: 'Пока слишком мало сообщений для записи.' })
    }
  })

  return () => {
    stopped = true
    clearInterval(interval)
    clearTimeout(first)
    off()
  }
}
