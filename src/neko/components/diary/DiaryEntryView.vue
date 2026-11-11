<template>
  <article class="entry" :style="{ '--mood': mood.color }">
    <!-- Заголовок -->
    <header class="head">
      <div class="date">{{ longDate }}</div>
      <h1>{{ entry.title || 'Без названия' }}</h1>
      <div class="meta">
        <span class="chip">
          {{ mood.emoji }} {{ mood.ru }}
          <span class="pips" :title="`Сила: ${Math.round(entry.mood.intensity * 100)}%`">
            <i v-for="n in 5" :key="n" :class="{ on: n <= pips }"></i>
          </span>
        </span>
        <span class="muted">{{ entry.messageCount }} сообщ. · {{ entry.source === 'manual' ? 'по твоей просьбе' : 'сама написала' }}</span>
      </div>
      <p v-if="entry.mood.summary" class="summary">«{{ entry.mood.summary }}»</p>
    </header>

    <!-- Фото -->
    <section v-if="entry.photos.length" class="photos">
      <figure
        v-for="(p, i) in entry.photos"
        :key="p.id"
        class="polaroid"
        :style="{ '--rot': ROT[i % ROT.length] + 'deg' }"
      >
        <button class="shot" :title="p.prompt || 'Открыть'" @click="open(p)">
          <img :src="diaryAPI.imageUrl(p.file)" :alt="p.caption || KIND[p.kind]" loading="lazy" />
        </button>
        <figcaption>
          <span class="kind">{{ KIND[p.kind] }}</span>
          <input
            v-if="editing === p.id"
            ref="captionInput"
            v-model="draft"
            class="cap-input"
            maxlength="200"
            @keydown.enter.prevent="saveCaption(p)"
            @keydown.esc.prevent="editing = null"
            @blur="saveCaption(p)"
          />
          <span v-else class="cap" title="Двойной клик — изменить подпись" @dblclick="startEdit(p)">
            {{ p.caption || 'без подписи' }}
          </span>
        </figcaption>
        <button class="ph-del" :title="photoDelete === p.id ? 'Нажми ещё раз' : 'Удалить фото'" @click="deletePhoto(p)">
          {{ photoDelete === p.id ? '?' : '✕' }}
        </button>
      </figure>
    </section>

    <!-- Текст -->
    <section class="text selectable" v-html="html"></section>

    <!-- Мысли о сообщениях -->
    <section v-if="entry.thoughts.length" class="thoughts">
      <h2>💭 Мои мысли о твоих сообщениях</h2>
      <div
        v-for="(t, i) in entry.thoughts"
        :key="i"
        class="thought"
        :style="{ '--c': EMOTIONS[t.emotion].color }"
      >
        <blockquote>«{{ t.about }}»</blockquote>
        <p class="selectable">{{ t.thought }}</p>
        <span class="t-emo" :title="EMOTIONS[t.emotion].ru">{{ EMOTIONS[t.emotion].emoji }}</span>
      </div>
    </section>

    <!-- Статистика эмоций -->
    <section v-if="entry.emotionStats.length" class="stats">
      <h2>🎭 Эмоции за этот период</h2>
      <div v-for="s in entry.emotionStats" :key="s.label" class="bar-row" :style="{ '--c': EMOTIONS[s.label].color }">
        <span class="bar-label">{{ EMOTIONS[s.label].emoji }} {{ EMOTIONS[s.label].ru }}</span>
        <span class="bar"><span class="fill" :style="{ width: (s.count / maxCount) * 100 + '%' }"></span></span>
        <span class="bar-n">{{ s.count }}</span>
      </div>
    </section>

    <!-- Действия -->
    <footer class="actions">
      <button class="btn" @click="fileInput?.click()">📎 Добавить фото</button>
      <input ref="fileInput" type="file" accept="image/*" hidden @change="onFile" />
      <button class="btn danger" @click="deleteEntry">{{ confirmEntry ? 'Точно удалить?' : '🗑 Удалить запись' }}</button>
      <span v-if="entry.model" class="muted model">модель: {{ entry.model }}</span>
    </footer>

    <ImageLightbox v-if="lightbox" :src="lightbox.src" :caption="lightbox.caption" @close="lightbox = null" />
  </article>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import type { DiaryEntry, DiaryPhoto, DiaryPhotoKind } from '@shared/types'
import { EMOTIONS } from '@shared/services/emotion'
import { renderMarkdown } from '@shared/services/markdown'
import ImageLightbox from '@shared/components/ImageLightbox.vue'
import { diaryAPI } from '@neko/services/diaryClient'
import { useDiaryStore } from '@neko/stores/diaryStore'

const props = defineProps<{ entry: DiaryEntry }>()
const diary = useDiaryStore()

const ROT = [-2.2, 1.6, -1.1, 2.4, -1.7, 0.9]
const KIND: Record<DiaryPhotoKind, string> = {
  selfie: '📸 селфи',
  generated: '🎨 рисунок',
  user: '🖼 твоё фото',
  card: '🃏 открытка',
}

const mood = computed(() => EMOTIONS[props.entry.mood.label])
const pips = computed(() => Math.max(1, Math.round(props.entry.mood.intensity * 5)))
const maxCount = computed(() => Math.max(1, ...props.entry.emotionStats.map((s) => s.count)))
const html = computed(() => renderMarkdown(props.entry.text))
const longDate = computed(() =>
  new Date(`${props.entry.date}T12:00:00`).toLocaleDateString('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
)

/* ───────────── фото ───────────── */

const lightbox = ref<{ src: string; caption?: string } | null>(null)
const open = (p: DiaryPhoto) => { lightbox.value = { src: diaryAPI.imageUrl(p.file), caption: p.caption || undefined } }

const editing = ref<string | null>(null)
const draft = ref('')
const captionInput = ref<HTMLInputElement[] | HTMLInputElement>()

const startEdit = async (p: DiaryPhoto) => {
  editing.value = p.id
  draft.value = p.caption
  await nextTick()
  const el = Array.isArray(captionInput.value) ? captionInput.value[0] : captionInput.value
  el?.focus()
}
const saveCaption = async (p: DiaryPhoto) => {
  if (editing.value !== p.id) return // blur после Esc/Enter
  editing.value = null
  if (draft.value.trim() !== p.caption) await diary.setCaption(props.entry.id, p.id, draft.value)
}

// удаление — в два клика, чтобы случайно не потерять фото
const photoDelete = ref<string | null>(null)
let photoTimer: ReturnType<typeof setTimeout> | null = null
const deletePhoto = async (p: DiaryPhoto) => {
  if (photoDelete.value !== p.id) {
    photoDelete.value = p.id
    if (photoTimer) clearTimeout(photoTimer)
    photoTimer = setTimeout(() => { photoDelete.value = null }, 2500)
    return
  }
  photoDelete.value = null
  await diary.removePhoto(props.entry.id, p.id)
}

const fileInput = ref<HTMLInputElement>()
const onFile = async (e: Event) => {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  input.value = ''
  if (f) await diary.addUserPhoto(props.entry.id, f)
}

/* ───────────── запись ───────────── */

const confirmEntry = ref(false)
let entryTimer: ReturnType<typeof setTimeout> | null = null
const deleteEntry = async () => {
  if (!confirmEntry.value) {
    confirmEntry.value = true
    if (entryTimer) clearTimeout(entryTimer)
    entryTimer = setTimeout(() => { confirmEntry.value = false }, 3000)
    return
  }
  confirmEntry.value = false
  await diary.remove(props.entry.id)
}

onBeforeUnmount(() => {
  if (photoTimer) clearTimeout(photoTimer)
  if (entryTimer) clearTimeout(entryTimer)
})
</script>

<style scoped>
.entry {
  max-width: 740px;
  margin: 0 auto;
  padding: 22px 26px 40px;
  display: flex;
  flex-direction: column;
  gap: 22px;
  color: var(--text-primary);
}

/* Заголовок */
.date { font-size: 12px; text-transform: capitalize; color: var(--text-secondary); letter-spacing: 0.4px; }
h1 {
  margin: 4px 0 10px;
  font-size: 26px;
  line-height: 1.2;
  font-family: 'Segoe Print', 'Bradley Hand', 'Segoe UI', cursive;
  font-weight: 600;
}
.meta { display: flex; align-items: center; flex-wrap: wrap; gap: 10px 14px; }
.chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 12px;
  background: color-mix(in srgb, var(--mood) 22%, transparent);
  border: 1px solid color-mix(in srgb, var(--mood) 55%, transparent);
}
.pips { display: inline-flex; gap: 3px; }
.pips i { width: 6px; height: 6px; border-radius: 50%; background: color-mix(in srgb, var(--mood) 25%, transparent); }
.pips i.on { background: var(--mood); }
.muted { font-size: 11px; color: var(--text-secondary); }
.summary {
  margin-top: 12px;
  padding-left: 12px;
  border-left: 3px solid var(--mood);
  font-style: italic;
  font-size: 13px;
  color: var(--text-secondary);
}

/* Фото-«полароиды» */
.photos { display: flex; flex-wrap: wrap; gap: 20px 22px; padding: 4px 2px; }
.polaroid {
  position: relative;
  width: 210px;
  padding: 10px 10px 12px;
  background: #fbf8f2;
  color: #2a2438;
  border-radius: 4px;
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.35);
  transform: rotate(var(--rot));
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}
.polaroid:hover { transform: rotate(0deg) translateY(-3px); box-shadow: 0 14px 30px rgba(0, 0, 0, 0.45); z-index: 2; }
.shot { display: block; width: 100%; padding: 0; border: none; background: #ddd; cursor: zoom-in; }
.shot:hover { transform: none; }
.shot img { display: block; width: 100%; aspect-ratio: 4 / 5; object-fit: cover; }
figcaption { margin-top: 8px; display: flex; flex-direction: column; gap: 2px; min-height: 34px; }
.kind { font-size: 9px; letter-spacing: 0.5px; text-transform: uppercase; color: #8a8798; }
.cap { font-family: 'Segoe Print', 'Bradley Hand', 'Segoe UI', cursive; font-size: 12px; line-height: 1.3; cursor: text; }
.cap-input {
  font-family: 'Segoe Print', 'Bradley Hand', 'Segoe UI', cursive;
  font-size: 12px;
  border: none;
  border-bottom: 1px solid #9b7bb8;
  background: transparent;
  outline: none;
  color: #2a2438;
  width: 100%;
}
.ph-del {
  position: absolute;
  top: -8px;
  right: -8px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: none;
  background: var(--danger);
  color: #fff;
  font-size: 11px;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s;
}
.polaroid:hover .ph-del { opacity: 1; }

/* Текст записи */
.text { font-size: 14px; line-height: 1.75; font-family: Georgia, 'Times New Roman', serif; }
.text :deep(p) { margin: 0 0 12px; }
.text :deep(p:last-child) { margin-bottom: 0; }
.text :deep(a) { color: var(--accent-blue); }

h2 { font-size: 13px; letter-spacing: 0.5px; margin-bottom: 10px; color: var(--text-secondary); font-weight: 600; }

/* Мысли */
.thoughts { display: flex; flex-direction: column; gap: 10px; }
.thought {
  position: relative;
  padding: 12px 40px 12px 14px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--c) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--c) 35%, transparent);
}
.thought blockquote {
  font-size: 11px;
  color: var(--text-secondary);
  border-left: 2px solid var(--c);
  padding-left: 8px;
  margin-bottom: 6px;
  overflow-wrap: anywhere;
}
.thought p { font-size: 13px; line-height: 1.55; }
.t-emo { position: absolute; top: 10px; right: 12px; font-size: 18px; }

/* Статистика */
.bar-row { display: grid; grid-template-columns: 140px 1fr 28px; align-items: center; gap: 10px; margin-bottom: 6px; font-size: 12px; }
.bar { height: 8px; border-radius: 4px; background: var(--input-bg); overflow: hidden; }
.fill { display: block; height: 100%; border-radius: 4px; background: var(--c); transition: width 0.4s ease; }
.bar-n { text-align: right; color: var(--text-secondary); }

/* Действия */
.actions { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; padding-top: 14px; border-top: 1px solid var(--panel-border); }
.btn {
  padding: 7px 14px;
  border-radius: 10px;
  font-size: 12px;
  cursor: pointer;
  color: var(--text-primary);
  background: var(--active-bg);
  border: 1px solid var(--panel-border);
}
.btn:hover { border-color: var(--accent-purple); }
.btn.danger:hover { border-color: var(--danger); color: var(--danger); }
.model { margin-left: auto; }
</style>
