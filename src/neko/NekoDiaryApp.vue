<template>
  <div class="win-root">
    <div class="drag-strip"><span class="drag-grip"></span></div>
    <div class="window-card">
      <div class="window-head diary-head">
        <span class="title">📔 Дневник NEKO</span>
        <button class="write-btn" :disabled="diary.busy || !settingsStore.settings.diaryEnabled" @click="diary.requestWrite()">
          {{ diary.busy ? statusText : '✍️ Написать сейчас' }}
        </button>
        <button class="write-btn" :disabled="!diary.entries.length || diary.exporting" title="Сохранить дневник в файл" @click="exportOpen = !exportOpen">
          {{ diary.exporting ? 'Сохраняю…' : '⬇️ Экспорт' }}
        </button>
        <button class="close-btn" @click="close">✕</button>
      </div>

      <div v-if="exportOpen" class="export-panel">
        <div class="ex-title">Что сохранить</div>
        <label class="ex-row"><input v-model="scope" type="radio" value="current" :disabled="!diary.selected" /> Эту запись</label>
        <label v-if="diary.filterActive" class="ex-row"><input v-model="scope" type="radio" value="filtered" /> Найденные ({{ diary.filtered.length }})</label>
        <label class="ex-row"><input v-model="scope" type="radio" value="all" /> Весь дневник ({{ diary.entries.length }})</label>
        <label class="ex-row ex-sep"><input v-model="withImages" type="checkbox" /> С картинками</label>
        <div class="ex-btns">
          <button class="write-btn" @click="doExport('md')">Markdown (.md)</button>
          <button class="write-btn" @click="doExport('pdf')">PDF</button>
        </div>
        <p class="ex-hint">В Markdown картинки кладутся в папку рядом с файлом. Файл сохраняется только на этом компьютере.</p>
      </div>

      <div class="window-body">
        <DiarySidebar />

        <main class="main">
          <div v-if="diary.notice" class="banner error" @click="diary.notice = ''">{{ diary.notice }} <small>(нажми, чтобы скрыть)</small></div>
          <div v-else-if="diary.busy" class="banner busy">{{ statusText }}</div>
          <div v-if="diary.exportInfo" class="banner" @click="diary.exportInfo = ''">✅ {{ diary.exportInfo }} <small>(нажми, чтобы скрыть)</small></div>
          <div v-if="!settingsStore.settings.diaryEnabled" class="banner">Дневник выключен в настройках — новые записи не пишутся.</div>

          <div class="scroll">
            <DiaryEntryView v-if="diary.selected" :key="diary.selected.id" :entry="diary.selected" />

            <div v-else-if="diary.loaded" class="empty">
              <div class="empty-icon">📔</div>
              <h2>Здесь пока пусто</h2>
              <p>
                Поболтай с NEKO — когда наберётся хотя бы {{ settingsStore.settings.diaryMinMessages }} сообщений и вы замолчите на
                {{ settingsStore.settings.diaryIdleMinutes }} мин, она сама запишет в дневник мысли о вашем разговоре, своё настроение
                и приложит фотографии.
              </p>
              <p>Или нажми «Написать сейчас» — если уже есть о чём писать.</p>
            </div>
          </div>
        </main>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useSettingsStore } from '@shared/stores/settingsStore'
import { useDiaryStore } from '@neko/stores/diaryStore'
import DiarySidebar from './components/diary/DiarySidebar.vue'
import DiaryEntryView from './components/diary/DiaryEntryView.vue'

const diary = useDiaryStore()
const settingsStore = useSettingsStore() // читаем settingsStore.settings напрямую: объект заменяется при синхронизации между окнами

const statusText = computed(() =>
  diary.status.state === 'drawing' ? '🎨 Рисую иллюстрацию…' : '✍️ Пишу запись…'
)

const exportOpen = ref(false)
const scope = ref<'current' | 'filtered' | 'all'>('current')
const withImages = ref(true)
// по умолчанию предлагаем самое «узкое»: найденные → выбранная запись → весь дневник
watch([exportOpen, () => diary.filterActive, () => !!diary.selected], () => {
  if (!exportOpen.value) return
  if (scope.value === 'filtered' && !diary.filterActive) scope.value = diary.selected ? 'current' : 'all'
  if (scope.value === 'current' && !diary.selected) scope.value = 'all'
})
const doExport = (format: 'md' | 'pdf') => {
  exportOpen.value = false
  void diary.exportEntries(scope.value, format, withImages.value)
}

onMounted(() => void diary.init())
onBeforeUnmount(() => diary.dispose())

const close = () => window.electronAPI?.invoke('close-self')
</script>

<style scoped>
.diary-head { -webkit-app-region: drag; }
.diary-head button { -webkit-app-region: no-drag; }
.write-btn {
  padding: 6px 14px;
  border-radius: 10px;
  font-size: 12px;
  cursor: pointer;
  color: var(--text-primary);
  background: var(--active-bg);
  border: 1px solid var(--panel-border);
}
.write-btn:hover:not(:disabled) { border-color: var(--accent-purple); }
.write-btn:disabled { opacity: 0.6; cursor: default; }

.window-card { position: relative; }
.export-panel {
  position: absolute;
  top: 48px;
  right: 12px;
  z-index: 20;
  width: 250px;
  padding: 12px 14px;
  border-radius: 12px;
  background: rgba(var(--card-rgb), 0.98);
  border: 1px solid var(--panel-border);
  box-shadow: var(--shadow-card);
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
}
.ex-title { font-weight: 600; margin-bottom: 2px; }
.ex-row { display: flex; align-items: center; gap: 8px; cursor: pointer; }
.ex-sep { margin-top: 4px; }
.ex-btns { display: flex; gap: 8px; margin-top: 6px; }
.ex-btns .write-btn { flex: 1; }
.ex-hint { margin: 4px 0 0; font-size: 11px; color: var(--text-secondary); line-height: 1.4; }

.main { display: flex; flex-direction: column; min-height: 0; min-width: 0; }
.scroll { flex: 1; min-height: 0; overflow-y: auto; }

.banner {
  margin: 10px 16px 0;
  padding: 8px 12px;
  border-radius: 10px;
  font-size: 12px;
  background: var(--active-bg);
  border: 1px solid var(--panel-border);
  color: var(--text-primary);
}
.banner.busy { animation: pulse-mic 2s infinite; }
.banner.error { background: rgba(224, 104, 95, 0.14); border-color: rgba(224, 104, 95, 0.45); cursor: pointer; }
.banner small { opacity: 0.6; }

.empty {
  max-width: 440px;
  margin: 70px auto 0;
  padding: 0 24px;
  text-align: center;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.65;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.empty-icon { font-size: 44px; opacity: 0.7; }
.empty h2 { font-size: 16px; color: var(--text-primary); }
</style>
