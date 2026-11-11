// src/neko/stores/diaryStore.ts
// Хранилище окна дневника. Сами записи лежат на диске (electron/diaryStore.ts), здесь — зеркало для UI:
// обновляется по событию diary:changed, поэтому запись, написанная в фоне, появляется в открытом окне сама.

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { DiaryEntry, DiaryPhoto, EmotionLabel } from '@shared/types'
import { EMOTION_LABELS } from '@shared/services/emotion'
import { activeEmotions, emotionCounts, filterDiary } from '@neko/services/diaryFilter'
import { diaryAPI } from '@neko/services/diaryClient'
import type { DiaryStatus } from '@neko/services/diaryService'
import { fileToDataUrl } from '@neko/services/imageFile'

const sortEntries = (list: DiaryEntry[]) =>
  [...list].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)

const newPhotoId = () => `ph_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

export const useDiaryStore = defineStore('diary', () => {
  const entries = ref<DiaryEntry[]>([])
  const selectedId = ref<string | null>(null)
  const loaded = ref(false)
  const query = ref('')
  const status = ref<DiaryStatus>({ state: 'idle' })
  const notice = ref('') // ошибка/подсказка, которую показываем поверх записи
  const awaitingNew = ref(false)
  const exporting = ref(false)
  /** Сообщение об успешном экспорте («Сохранено: …») */
  const exportInfo = ref('')

  const busy = computed(() => status.value.state === 'writing' || status.value.state === 'drawing')
  const selected = computed(() => entries.value.find((e) => e.id === selectedId.value) ?? null)

  /** Эмоции, выбранные «чипами» в боковой панели */
  const emotionFilter = ref<EmotionLabel[]>([])

  const filtered = computed(() => filterDiary(entries.value, { query: query.value, emotions: emotionFilter.value }))
  /** Какие эмоции сейчас действуют (чипы + слова в строке поиска: «грустно», «радовалась»…) */
  const filterEmotions = computed(() => activeEmotions({ query: query.value, emotions: emotionFilter.value }).all)
  /** Чипы: только эмоции, которые есть хотя бы в одной записи */
  const emotionChips = computed(() => emotionCounts(entries.value, EMOTION_LABELS))
  const filterActive = computed(() => !!query.value.trim() || emotionFilter.value.length > 0)

  const toggleEmotion = (label: EmotionLabel) => {
    emotionFilter.value = emotionFilter.value.includes(label)
      ? emotionFilter.value.filter((x) => x !== label)
      : [...emotionFilter.value, label]
  }
  const clearFilters = () => { query.value = ''; emotionFilter.value = [] }

  const refresh = async () => {
    const known = new Set(entries.value.map((e) => e.id))
    const list = sortEntries(await diaryAPI.list())
    const fresh = list.filter((e) => !known.has(e.id))
    entries.value = list

    if (awaitingNew.value && fresh.length > 0) {
      selectedId.value = [...fresh].sort((a, b) => b.createdAt - a.createdAt)[0].id // «Написать сейчас» → сразу показываем
      awaitingNew.value = false
    } else if (!selectedId.value || !list.some((e) => e.id === selectedId.value)) {
      selectedId.value = list[0]?.id ?? null
    }
    loaded.value = true
  }

  /* ───────────── подписки ───────────── */

  let offs: (() => void)[] = []
  let timer: ReturnType<typeof setTimeout> | null = null

  const init = async () => {
    dispose()
    offs.push(
      diaryAPI.onChanged(() => {
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => void refresh(), 150) // запись и картинку главный процесс шлёт двумя событиями подряд
      })
    )
    offs.push(
      diaryAPI.onStatus((s) => {
        status.value = s
        if (s.state === 'error') awaitingNew.value = false
        notice.value = s.state === 'error' ? s.message ?? 'Не получилось написать запись.' : ''
      })
    )
    status.value = await diaryAPI.getStatus()
    await refresh()
  }

  const dispose = () => {
    offs.forEach((fn) => fn())
    offs = []
    if (timer) clearTimeout(timer)
  }

  /* ───────────── действия ───────────── */

  const select = (id: string) => { selectedId.value = id }

  const requestWrite = async () => {
    notice.value = ''
    awaitingNew.value = true
    const ok = await diaryAPI.requestWrite()
    if (!ok) {
      awaitingNew.value = false
      notice.value = 'Главное окно NEKO не запущено — записи пишутся только из него.'
    }
  }

  /** Экспорт в Markdown/PDF: одна запись, найденные по фильтру или весь дневник */
  const exportEntries = async (scope: 'current' | 'filtered' | 'all', format: 'md' | 'pdf', images: boolean) => {
    const ids = scope === 'all' ? null : scope === 'current' ? (selectedId.value ? [selectedId.value] : []) : filtered.value.map((e) => e.id)
    if (ids && !ids.length) { notice.value = 'Нет записей для экспорта'; return }
    exporting.value = true
    notice.value = ''
    exportInfo.value = ''
    try {
      const r = await diaryAPI.export({ format, ids, images })
      if (r.ok) exportInfo.value = `Сохранено: записей ${r.count}${r.images ? `, фото ${r.images}` : ''} → ${r.path}`
      else if (!r.canceled) notice.value = `Экспорт не удался: ${r.error ?? 'неизвестная ошибка'}`
    } finally {
      exporting.value = false
    }
  }

  const remove = async (id: string) => {
    await diaryAPI.remove(id)
    await refresh()
  }

  /** Берём свежую копию с диска перед правкой — вдруг фоновая запись как раз дописала иллюстрацию */
  const mutate = async (id: string, fn: (e: DiaryEntry) => void): Promise<boolean> => {
    const fresh = await diaryAPI.get(id)
    if (!fresh) return false
    fn(fresh)
    fresh.updatedAt = Date.now()
    const saved = await diaryAPI.save(fresh)
    if (saved) await refresh()
    return !!saved
  }

  const addUserPhoto = async (id: string, file: File) => {
    notice.value = ''
    try {
      const file_ = await diaryAPI.addImage(await fileToDataUrl(file))
      const photo: DiaryPhoto = { id: newPhotoId(), file: file_, kind: 'user', caption: '', createdAt: Date.now() }
      const ok = await mutate(id, (e) => { e.photos.push(photo) })
      if (!ok) await diaryAPI.removeImage(file_)
    } catch (e) {
      notice.value = e instanceof Error ? e.message : 'Не удалось добавить фото'
    }
  }

  const removePhoto = async (id: string, photoId: string) => {
    let file = ''
    const ok = await mutate(id, (e) => {
      const p = e.photos.find((x) => x.id === photoId)
      if (p) file = p.file
      e.photos = e.photos.filter((x) => x.id !== photoId)
    })
    if (ok && file) await diaryAPI.removeImage(file)
  }

  const setCaption = (id: string, photoId: string, caption: string) =>
    mutate(id, (e) => {
      const p = e.photos.find((x) => x.id === photoId)
      if (p) p.caption = caption.trim().slice(0, 200)
    })

  return {
    entries, selectedId, selected, filtered, loaded, query, status, notice, busy,
    emotionFilter, filterEmotions, emotionChips, filterActive, toggleEmotion, clearFilters,
    exporting, exportInfo, exportEntries,
    init, dispose, refresh, select, requestWrite, remove, addUserPhoto, removePhoto, setCaption,
  }
})
