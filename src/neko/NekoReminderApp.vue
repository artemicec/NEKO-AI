<template>
  <div class="win-root">
    <div class="drag-strip"><span class="drag-grip"></span></div>
    <div class="window-card">
      <div class="window-head">
        <span class="title center">⏰ Напоминание</span>
        <button class="close-btn" title="Закрыть все" @click="closeAll">✕</button>
      </div>

      <div class="window-body scroll">
        <div class="list">
          <div v-for="r in items" :key="r.id" class="card">
            <div class="when">{{ time(r.at) }}<span v-if="r.missed" class="missed"> · пропущено (приложение было закрыто)</span></div>
            <div class="text">{{ r.text }}</div>
            <div class="btns">
              <button class="s-btn" @click="ok(r.id)">Ок</button>
              <button class="s-btn" @click="later(r.id, 10)">Через 10 мин</button>
              <button class="s-btn" @click="later(r.id, 60)">Через час</button>
            </div>
          </div>
        </div>
        <button v-if="items.length > 1" class="s-btn all" @click="closeAll">Закрыть все ({{ items.length }})</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { reminderAPI, type Reminder } from '@shared/services/reminderClient'

const items = ref<Reminder[]>([])
const close = () => window.electronAPI?.invoke('close-self')

const time = (at: number) => new Date(at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })

async function refresh() {
  items.value = await reminderAPI.fired()
  if (!items.value.length) close() // всё закрыто — окно больше не нужно
}

const ok = async (id: string) => { await reminderAPI.dismiss(id); await refresh() }
const later = async (id: string, minutes: number) => { await reminderAPI.snooze(id, minutes); await refresh() }
const closeAll = async () => { await reminderAPI.dismissAll(); close() }

let off: (() => void) | undefined
onMounted(() => {
  off = reminderAPI.onChanged(() => void refresh())
  void refresh()
})
onBeforeUnmount(() => off?.())
</script>

<style scoped>
.list { display: flex; flex-direction: column; gap: 10px; padding: 12px; }
.card { padding: 10px 12px; border: 1px solid var(--panel-border); border-radius: 12px; background: var(--hover-bg); }
.when { font-size: 11px; color: var(--text-muted); }
.missed { color: var(--danger); }
.text { margin: 4px 0 10px; font-size: 14px; line-height: 1.4; word-break: break-word; color: var(--text-primary); }
.btns { display: flex; flex-wrap: wrap; gap: 6px; }
.all { margin: 0 12px 12px; }
</style>
