<template>
  <Teleport to="body">
    <div class="lb" role="dialog" aria-modal="true" @click.self="emit('close')">
      <figure class="lb-fig">
        <img :src="src" :alt="caption || 'Изображение'" />
        <figcaption v-if="caption">{{ caption }}</figcaption>
      </figure>
      <button class="lb-close" aria-label="Закрыть" @click="emit('close')">✕</button>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'

defineProps<{ src: string; caption?: string }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const onKey = (e: KeyboardEvent) => {
  if (e.key === 'Escape') emit('close')
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<style scoped>
.lb {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(8, 6, 14, 0.82);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  -webkit-app-region: no-drag;
  animation: fade-in 0.18s ease;
}
.lb-fig {
  max-width: 92vw;
  max-height: 92vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}
.lb-fig img {
  max-width: 92vw;
  max-height: 82vh;
  object-fit: contain;
  border-radius: 10px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
  user-select: none;
}
.lb-fig figcaption {
  color: #ede9f2;
  font-size: 13px;
  text-align: center;
  max-width: 80vw;
}
.lb-close {
  position: absolute;
  top: 14px;
  right: 16px;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  font-size: 15px;
  cursor: pointer;
}
.lb-close:hover { background: rgba(255, 68, 68, 0.35); }
</style>
