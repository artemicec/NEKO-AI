// src/neko/stores/nekoStore.ts
// Небольшое хранилище настроения NEKO (кууредере/дередере) — сейчас напрямую в UI не используется,
// выражением лица управляют эмоции из shared/services/emotion.ts. Оставлено для совместимости.

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { NekoEmotion } from '@shared/types'

export const useNekoStore = defineStore('neko', () => {
  const emotion = ref<NekoEmotion>({ type: 'neutral', intensity: 0.5, expression: 'neutral' })
  const moodHistory = ref<NekoEmotion[]>([])

  const currentMood = computed(() => {
    if (emotion.value.type === 'kuudere') return 'Холодный Сапфир'
    if (emotion.value.type === 'deredere') return 'Тёплый Янтарь'
    return 'Нейтральное'
  })

  const setEmotion = (type: NekoEmotion['type'], intensity: number, expression: string) => {
    emotion.value = { type, intensity: Math.max(0, Math.min(1, intensity)), expression }
    moodHistory.value.push({ ...emotion.value })
    if (moodHistory.value.length > 50) moodHistory.value.shift()
  }

  return { emotion, currentMood, moodHistory, setEmotion }
})
