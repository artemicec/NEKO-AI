<template>
  <div class="bubble-row" :class="[message.role, { error: message.error, console: variant === 'console' }]">
    <div v-if="message.role === 'assistant' && variant !== 'console'" class="bubble-avatar">{{ avatar }}</div>
    <div class="bubble">
      <div v-if="message.plugin" class="plugin-tag">{{ message.plugin }}</div>

      <div v-if="message.imageUrl" class="bubble-image">
        <img
          :src="message.imageUrl"
          :alt="message.imageAlt || 'Изображение'"
          @click="openImage"
        />
      </div>

      <!-- Модель ещё не выдала ни буквы -->
      <div v-if="message.streaming && !message.content" class="dots"><span></span><span></span><span></span></div>
      <div v-else-if="html" class="bubble-text selectable" :class="{ live: message.streaming }" v-html="html"></div>

      <!-- Какие дни NEKO вспомнила (ответ по дневнику и прошлой переписке) -->
      <div v-if="recall.length && !message.streaming" class="sources">
        <span v-for="r in recall" :key="r.date" class="source recall" :title="'Вспомнила ' + r.date">🧠 {{ r.label }}</span>
      </div>

      <!-- Откуда взяты данные (ответ по информации из интернета). Ссылки открываются во внешнем браузере -->
      <div v-if="sources.length && !message.streaming" class="sources">
        <a
          v-for="src in sources"
          :key="src.url"
          class="source"
          :class="src.kind"
          :href="src.url"
          :title="src.title"
          target="_blank"
          rel="noopener noreferrer"
        >{{ src.label }}</a>
      </div>

      <div class="bubble-meta">
        <span v-if="variant === 'console'" class="who">{{ who }}</span>
        <span v-if="emotion && variant !== 'console'" class="emo" :title="emotion.ru">{{ emotion.emoji }}</span>
        <span class="time">{{ time }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Message } from '@shared/types'
import { renderMarkdown } from '@shared/services/markdown'
import { EMOTIONS } from '@shared/services/emotion'
import { safeHttpUrl } from '@shared/services/webSearch'

const props = withDefaults(
  defineProps<{ message: Message; avatar?: string; who?: string; variant?: 'bubble' | 'console' }>(),
  { avatar: '🐱', who: '', variant: 'bubble' }
)
const emit = defineEmits<{ (e: 'open-image', url: string, caption?: string): void }>()

const openImage = () => {
  const url = props.message.imageUrl
  if (url) emit('open-image', url, props.message.imageAlt)
}

// computed кэширует результат: при стриминге пересчитывается только пузырь, который меняется
const html = computed(() => renderMarkdown(props.message.content))

/** Не больше четырёх ссылок; показываем только http/https (сообщение могло прийти с диска) */
const sources = computed(() => {
  const out: { url: string; title: string; kind: string; label: string }[] = []
  for (const src of props.message.sources ?? []) {
    const url = safeHttpUrl(src?.url)
    if (!url || out.some((o) => o.url === url)) continue
    const host = new URL(url).hostname.replace(/^www\./, '')
    out.push({ url, title: String(src.title ?? host), kind: src.kind === 'wikipedia' ? 'wikipedia' : 'web', label: src.kind === 'wikipedia' ? 'Википедия' : host })
    if (out.length === 4) break
  }
  return out
})

/** Подписи «вспомнила»: не больше четырёх; сообщение могло прийти с диска, поэтому форму проверяем */
const recall = computed(() => {
  const out: { date: string; label: string }[] = []
  for (const r of props.message.recall ?? []) {
    if (r && typeof r.date === 'string' && typeof r.label === 'string' && r.label && !out.some((o) => o.date === r.date)) out.push({ date: r.date, label: r.label.slice(0, 16) })
    if (out.length === 4) break
  }
  return out
})

const time = computed(() =>
  new Date(props.message.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
)

const emotion = computed(() => {
  const label = props.message.emotion?.label
  return props.message.role === 'assistant' && label && label !== 'neutral' ? EMOTIONS[label] : null
})
</script>

<style scoped>
.bubble-row {
  display: flex;
  gap: 8px;
  align-items: flex-end;
  animation: fade-in 0.28s ease;
}
.bubble-row.user { flex-direction: row-reverse; }

.bubble-avatar {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: var(--active-bg);
  border: 1px solid var(--panel-border);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  flex-shrink: 0;
}

.bubble {
  max-width: 85%;
  padding: 9px 12px;
  border-radius: 14px;
  background: var(--bubble-ai);
  border: 1px solid var(--panel-border);
  font-size: 13px;
  line-height: 1.5;
  min-width: 0;
}
.bubble-row.user .bubble { background: var(--bubble-user); }
.bubble-row.error .bubble {
  background: rgba(224, 104, 95, 0.14);
  border-color: rgba(224, 104, 95, 0.45);
}

.bubble-text {
  color: var(--text-primary);
  overflow-wrap: anywhere;
}
.bubble-text :deep(p) { margin: 0 0 4px 0; }
.bubble-text :deep(p:last-child) { margin-bottom: 0; }
.bubble-text :deep(ul), .bubble-text :deep(ol) { margin: 2px 0 4px 18px; }
.bubble-text :deep(a) { color: var(--accent-blue); }
.bubble-text :deep(code) {
  background: var(--input-bg);
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 12px;
}
.bubble-text :deep(pre) {
  background: var(--input-bg);
  padding: 8px 10px;
  border-radius: 8px;
  overflow-x: auto;
  margin: 4px 0;
}
.bubble-text :deep(pre code) { background: none; padding: 0; }
/* мигающий курсор в конце печатающегося ответа */
.bubble-text.live :deep(> :last-child)::after {
  content: '▍';
  margin-left: 2px;
  color: var(--accent-purple);
  animation: blink 1s steps(2, start) infinite;
}
@keyframes blink { to { visibility: hidden; } }

.dots { display: flex; gap: 4px; padding: 4px 0; }
.dots span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent-purple);
  animation: dot 1.2s infinite;
}
.dots span:nth-child(2) { animation-delay: 0.15s; }
.dots span:nth-child(3) { animation-delay: 0.3s; }
@keyframes dot {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
  30% { transform: translateY(-5px); opacity: 1; }
}

.plugin-tag {
  display: inline-block;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 6px;
  background: var(--accent-purple);
  color: #fff;
  margin-bottom: 5px;
}

.sources { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.source {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10.5px;
  line-height: 1.4;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid var(--panel-border);
  color: var(--text-secondary);
  text-decoration: none;
  user-select: none;
  transition: color 0.15s, background 0.15s;
}
.source:hover { color: var(--accent-blue); background: var(--hover-bg); }
.source.wikipedia { color: var(--accent-blue); }
.source.recall { cursor: default; color: var(--accent-purple); }
.source.recall:hover { background: transparent; color: var(--accent-purple); }

.bubble-image {
  margin: 4px 0 6px;
  border-radius: 8px;
  overflow: hidden;
  max-width: 240px;
  border: 1px solid var(--panel-border);
}
.bubble-image img {
  width: 100%;
  height: auto;
  display: block;
  cursor: zoom-in;
  transition: transform 0.2s;
}
.bubble-image img:hover { transform: scale(1.02); }

.bubble-meta {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  color: var(--text-muted);
  margin-top: 4px;
}
.emo { font-size: 11px; }
</style>
