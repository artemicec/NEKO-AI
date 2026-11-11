<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="visible" class="overlay" @click.self="emit('close')">
        <div class="modal">
          <div class="modal-head">
            <button v-if="current" class="back-btn" @click="pageId = null">‹</button>
            <h2>{{ current ? current.label : 'Настройки' }}</h2>
            <button class="close-btn" @click="emit('close')">✕</button>
          </div>

          <div v-if="!current" class="category-list">
            <button v-for="p in pages" :key="p.id" class="category-item" @click="pageId = p.id">
              <span class="cat-icon">{{ p.icon }}</span>
              <span class="cat-label">{{ p.label }}</span>
              <span class="chev">›</span>
            </button>
          </div>
          <div v-else class="modal-body">
            <component :is="current.component" />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { pagesFor } from './settings/pages'

const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const pages = pagesFor()
const pageId = ref<string | null>(null)
const current = computed(() => pages.find((p) => p.id === pageId.value) ?? null)

watch(() => props.visible, (v) => { if (v) pageId.value = null })
</script>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  -webkit-app-region: no-drag;
}
.modal {
  width: 380px;
  height: 520px;
  background: rgba(var(--card-rgb), var(--card-alpha));
  border: 1px solid var(--panel-border);
  border-radius: 18px;
  box-shadow: var(--shadow-card);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: modal-in 0.3s cubic-bezier(0.22, 1, 0.36, 1);
}
@keyframes modal-in {
  from { opacity: 0; transform: scale(0.95) translateY(10px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}
.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  background: rgba(var(--head-rgb), 0.9);
  border-bottom: 1px solid var(--panel-border);
  flex-shrink: 0;
}
.modal-head h2 { font-size: 15px; font-weight: 600; letter-spacing: 0.5px; flex: 1; text-align: center; }
.close-btn, .back-btn {
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 18px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
  min-width: 30px;
}
.close-btn:hover, .back-btn:hover { background: var(--hover-bg); color: var(--text-primary); }
.category-list { padding: 8px 0; overflow-y: auto; flex: 1; }
.category-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 15px 22px;
  background: none;
  border: none;
  color: var(--text-primary);
  font-size: 14px;
  cursor: pointer;
  font-family: inherit;
}
.category-item:hover { background: var(--hover-bg); }
.cat-icon { font-size: 16px; width: 22px; text-align: center; }
.cat-label { flex: 1; text-align: left; }
.chev { color: var(--text-muted); font-size: 18px; }
.modal-body { padding: 16px 20px; overflow-y: auto; flex: 1; }
.fade-enter-active, .fade-leave-active { transition: opacity 0.25s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
