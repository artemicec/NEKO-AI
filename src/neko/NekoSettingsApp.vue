<template>
  <div class="win-root">
    <div class="drag-strip"><span class="drag-grip"></span></div>
    <div class="window-card">
      <div class="window-head">
        <button v-if="current" class="back-btn" @click="pageId = null">‹</button>
        <span class="title center">{{ current ? `${current.icon} ${current.label}` : `⚙️ Настройки ${name}` }}</span>
        <button class="close-btn" @click="close">✕</button>
      </div>

      <div class="window-body scroll">
        <div v-if="!current" class="category-list">
          <button v-for="p in pages" :key="p.id" class="category-item" @click="pageId = p.id">
            <span class="cat-icon">{{ p.icon }}</span>
            <span class="cat-label">{{ p.label }}</span>
            <span class="chev">›</span>
          </button>
        </div>
        <div v-else class="sub-page">
          <component :is="current.component" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { pagesFor } from '@shared/components/settings/pages'
import { personaTitle } from '@shared/persona'

const pages = pagesFor()
const name = personaTitle()
// ?page=setup — окно открыто сразу на нужной странице (мастер первого запуска)
const initial = new URLSearchParams(window.location.search).get('page')
const pageId = ref<string | null>(pages.some((p) => p.id === initial) ? initial : null)
const current = computed(() => pages.find((p) => p.id === pageId.value) ?? null)

const close = () => window.electronAPI?.invoke('close-self')

// окно уже открыто, а его просят показать другую страницу
let offGoto: (() => void) | undefined
onMounted(() => {
  offGoto = window.electronAPI?.on('settings:goto', (id: unknown) => {
    if (typeof id === 'string' && pages.some((p) => p.id === id)) pageId.value = id
  })
})
onBeforeUnmount(() => offGoto?.())
</script>

<style scoped>
.category-list { display: flex; flex-direction: column; padding: 6px 0; }
.category-item {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 20px;
  background: none;
  border: none;
  color: var(--text-primary);
  font-size: 14px;
  font-family: inherit;
  cursor: pointer;
  text-align: left;
}
.category-item:hover { background: var(--hover-bg); }
.cat-icon { font-size: 16px; width: 22px; text-align: center; }
.cat-label { flex: 1; }
.chev { color: var(--text-muted); font-size: 18px; }
.sub-page { padding: 16px 18px 22px; }
</style>
