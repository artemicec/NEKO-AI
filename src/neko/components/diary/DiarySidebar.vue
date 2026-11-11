<template>
  <aside class="sidebar">
    <input v-model="diary.query" class="search" type="search" placeholder="Поиск… например: когда мне было грустно" />

    <div v-if="diary.emotionChips.length" class="chips">
      <button
        v-for="c in diary.emotionChips"
        :key="c.label"
        class="chip"
        :class="{ on: diary.emotionFilter.includes(c.label) }"
        :style="{ '--c': EMOTIONS[c.label].color }"
        :title="`Записи про «${EMOTIONS[c.label].ru}»`"
        @click="diary.toggleEmotion(c.label)"
      >{{ EMOTIONS[c.label].emoji }} {{ EMOTIONS[c.label].ru }} <small>{{ c.count }}</small></button>
    </div>
    <div v-if="diary.filterActive" class="found">
      <span>Найдено: {{ diary.filtered.length }} из {{ diary.entries.length }}</span>
      <button class="reset" @click="diary.clearFilters()">сбросить</button>
    </div>

    <div v-if="diary.filtered.length" class="list">
      <button
        v-for="e in diary.filtered"
        :key="e.id"
        class="item"
        :class="{ active: e.id === diary.selectedId }"
        :style="{ '--mood': EMOTIONS[e.mood.label].color }"
        @click="diary.select(e.id)"
      >
        <span class="mood-dot" :title="EMOTIONS[e.mood.label].ru">{{ EMOTIONS[e.mood.label].emoji }}</span>
        <span class="info">
          <span class="date">{{ shortDate(e.date) }}</span>
          <span class="title">{{ e.title || 'Без названия' }}</span>
        </span>
        <span v-if="e.photos.length" class="photos" :title="`Фото: ${e.photos.length}`">🖼 {{ e.photos.length }}</span>
      </button>
    </div>
    <p v-else-if="diary.loaded" class="none">{{ diary.filterActive ? 'Ничего не нашлось' : 'Записей пока нет' }}</p>
  </aside>
</template>

<script setup lang="ts">
import { EMOTIONS } from '@shared/services/emotion'
import { useDiaryStore } from '@neko/stores/diaryStore'

const diary = useDiaryStore()

const shortDate = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
</script>

<style scoped>
.sidebar {
  flex: 0 0 240px; /* перебивает .window-body > * { flex: 1 } */
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 8px 10px 10px;
  border-right: 1px solid var(--panel-border);
  min-height: 0;
}
.search {
  background: var(--input-bg);
  border: 1px solid var(--panel-border);
  border-radius: 10px;
  padding: 8px 12px;
  color: var(--text-primary);
  font-size: 12px;
  outline: none;
  font-family: inherit;
}
.search:focus { border-color: var(--accent-purple); }
.chips { display: flex; flex-wrap: wrap; gap: 4px; }
.chip {
  padding: 3px 8px;
  font-size: 11px;
  border-radius: 12px;
  border: 1px solid var(--panel-border);
  background: none;
  color: var(--text-primary);
  cursor: pointer;
  font-family: inherit;
  white-space: nowrap;
}
.chip small { opacity: 0.65; margin-left: 2px; }
.chip:hover { border-color: var(--c); }
.chip.on { background: color-mix(in srgb, var(--c) 30%, transparent); border-color: var(--c); }
.found { display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: var(--text-secondary); }
.reset { background: none; border: none; color: inherit; text-decoration: underline; cursor: pointer; font-size: 11px; font-family: inherit; padding: 0; }
.list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; padding-right: 2px; }
.item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border-radius: 12px;
  border: 1px solid transparent;
  background: none;
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
  font-family: inherit;
}
.item:hover { background: var(--hover-bg); transform: none; }
.item.active {
  background: var(--active-bg);
  border-color: color-mix(in srgb, var(--mood) 55%, transparent);
}
.mood-dot {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  flex-shrink: 0;
  background: color-mix(in srgb, var(--mood) 28%, transparent);
}
.info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.date { font-size: 10px; color: var(--text-secondary); letter-spacing: 0.3px; }
.title { font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.photos { font-size: 10px; color: var(--text-secondary); flex-shrink: 0; }
.none { font-size: 12px; color: var(--text-secondary); text-align: center; margin-top: 24px; }
</style>
