<template>
  <div ref="host" class="aria-avatar"></div>
</template>

<script setup lang="ts">
// Модель ARIA — отдельный .vrm (settings.ariaVrmModelPath), другой, чем у NEKO.
// Картинка в рост «по колени и выше», голубоватый свет, взгляд следит за камерой, мышью не крутится.
// Нет файла — сообщаем «missing», и родитель показывает «объектив».
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { VRMService } from '@neko/services/vrmService'
import { useSettingsStore } from '@shared/stores/settingsStore'
import { useChatStore } from '@shared/stores/chatStore'
import { speechOutput } from '@shared/services/speechOutput'
import type { AvatarStatus } from '../types'

const emit = defineEmits<{ (e: 'status', value: AvatarStatus): void }>()

const settingsStore = useSettingsStore()
const chatStore = useChatStore()
const host = ref<HTMLDivElement>()
const service = new VRMService()

let disposed = false
let loadId = 0
let offMouth: (() => void) | null = null
let offModels: (() => void) | null = null

// ARIA — ассистент, а не питомец: ей подходят только спокойные idle-анимации (без «сесть» и «лечь»)
const ANIMATIONS = [
  { name: 'idle1', url: '/animations/VRMA_01.vrma' },
  { name: 'idle2', url: '/animations/VRMA_02.vrma' },
]

const applyAutoAnimate = () => {
  const s = settingsStore.settings
  // start() повторно только меняет паузу (идущая анимация не обрывается); stop() плавно возвращает в стандартную позу
  if (s.autoAnimate && service.hasAnimations()) service.startRandomAnimations(s.animationPause)
  else service.stopRandomAnimations()
}

const load = async () => {
  const id = ++loadId
  const path = settingsStore.settings.ariaVrmModelPath.trim()
  emit('status', 'loading')
  const ok = path ? await service.loadModel(path) : false
  if (disposed || id !== loadId) return
  if (!ok) {
    service.setPaused(true)
    emit('status', 'missing')
    return
  }
  await service.loadAnimations(ANIMATIONS)
  if (disposed || id !== loadId) return
  applyAutoAnimate()
  service.setPaused(false)
  emit('status', 'ready')
}

onMounted(async () => {
  if (!host.value) return
  await service.initialize(host.value, {
    maxFps: settingsStore.settings.maxFps,
    fillColor: 0x7fb2ff,
    rimColor: 0x62e4ff,
    frame: 'bust',
    interactive: false,
    lookAtCamera: true,
  })
  if (disposed) return service.dispose()
  service.setPaused(true) // пока модели нет — не рисуем пустую сцену
  // Липсинк: чат и аватар ARIA в одном окне — форма рта приходит напрямую из озвучки, IPC не нужен
  offMouth = speechOutput.onMouth((m) => service.setMouth(m))
  // модель появилась (скачали образец или положили файл): перечитать без перезапуска
  offModels = window.electronAPI?.on('models:changed', () => { void load() }) ?? null
  await load()
})

// Выражение лица — по эмоции последнего ответа (в ARIA чат и аватар в одном окне, IPC не нужен)
watch(
  () => {
    const m = chatStore.messages[chatStore.messages.length - 1]
    return m && m.role === 'assistant' && !m.streaming ? m.emotion : undefined
  },
  (tag) => { if (tag) service.setEmotion(tag.label, tag.intensity ?? 0.7) }
)

watch(() => settingsStore.settings.maxFps, (v) => service.setMaxFps(v))
watch(() => [settingsStore.settings.autoAnimate, settingsStore.settings.animationPause], applyAutoAnimate)
watch(() => settingsStore.settings.ariaVrmModelPath, () => { void load() })

onBeforeUnmount(() => {
  disposed = true
  offMouth?.()
  offModels?.()
  service.dispose()
})
</script>
