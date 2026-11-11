<template>
  <div class="neko-avatar-container">
    <div ref="vrmContainer" class="vrm-viewer"></div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { useSettingsStore } from '@shared/stores/settingsStore'
import { VRMService } from '@neko/services/vrmService'
import type { EmotionLabel, EmotionTag } from '@shared/types'

const settingsStore = useSettingsStore()
const vrmContainer = ref<HTMLDivElement>()
const vrmService = new VRMService()
let disposed = false
let offEmotion: (() => void) | null = null
let offMouth: (() => void) | null = null

const animationFiles: { name: string; url: string }[] = [
  { name: 'idle1', url: '/animations/VRMA_01.vrma' },
  { name: 'idle2', url: '/animations/VRMA_02.vrma' },
  { name: 'sit1', url: '/animations/VRMA_03.vrma' },
  { name: 'sit2', url: '/animations/VRMA_04.vrma' },
  { name: 'lie1', url: '/animations/VRMA_05.vrma' },
  { name: 'headShake1', url: '/animations/VRMA_06.vrma' },
  { name: 'headShake2', url: '/animations/VRMA_07.vrma' },
]

const applyAutoAnimate = () => {
  const s = settingsStore.settings
  // start() повторно только меняет паузу (идущая анимация не обрывается); stop() плавно возвращает в стандартную позу
  if (s.autoAnimate && vrmService.hasAnimations()) vrmService.startRandomAnimations(s.animationPause)
  else vrmService.stopRandomAnimations()
}

const loadAvatar = async () => {
  await vrmService.loadModel(settingsStore.settings.vrmModelPath)
  if (disposed) return
  await vrmService.loadAnimations(animationFiles)
  if (!disposed) applyAutoAnimate()
}

onMounted(async () => {
  if (!vrmContainer.value) return
  await vrmService.initialize(vrmContainer.value, { maxFps: settingsStore.settings.maxFps })
  if (disposed) return vrmService.dispose()

  // Эмоция из ответа NEKO (приходит из окна чата через главный процесс) → выражение лица
  offEmotion = window.electronAPI?.on('emotion:changed', (tag: EmotionTag) => {
    if (tag && typeof tag.label === 'string') vrmService.setEmotion(tag.label, tag.intensity ?? 0.7)
  }) ?? null

  // Форма рта из окна, где звучит голос (липсинк): 5 весов гласных либо null — рот закрыт
  offMouth = window.electronAPI?.on('lipsync:frame', (frame: unknown) => {
    vrmService.setMouth(Array.isArray(frame) ? frame : null)
  }) ?? null

  await loadAvatar()
})

watch(() => settingsStore.settings.maxFps, (v) => vrmService.setMaxFps(v))
watch(() => [settingsStore.settings.autoAnimate, settingsStore.settings.animationPause], applyAutoAnimate)
watch(() => settingsStore.settings.vrmModelPath, () => { void loadAvatar() })

onUnmounted(() => {
  disposed = true
  offEmotion?.()
  offMouth?.()
  vrmService.dispose()
})

defineExpose({
  /** Портрет аватара (PNG data URL) — для «селфи» в дневнике */
  capture: (emotion?: EmotionLabel) => vrmService.capture(emotion),
  setEmotion: (label: EmotionLabel, intensity?: number) => vrmService.setEmotion(label, intensity),
})
</script>

<style scoped>
.neko-avatar-container {
  position: relative;
  width: 100%;
  height: 100%;
  background: transparent;
  overflow: hidden;
  border-radius: 18px;
}
.vrm-viewer {
  width: 100%;
  height: 100%;
  background: transparent;
}
</style>
