<template>
  <div class="win-root">
    <div class="drag-strip"><span class="drag-grip"></span></div>
    <div class="window-card">
      <div class="window-head">
        <span class="title">💬 Чат с NEKO</span>
        <button class="close-btn" @click="close">✕</button>
      </div>
      <div class="window-body">
        <ChatWindow />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import ChatWindow from '@shared/components/ChatWindow.vue'
import { useChatStore } from '@shared/stores/chatStore'
import { NEKO_PROMPT } from '@neko/prompt/nekoPrompt'

const chatStore = useChatStore()

onMounted(() => {
  chatStore.setSystemPrompt(NEKO_PROMPT)
  void chatStore.warmup() // если модель уже в памяти — это мгновенно; если нет — первый ответ придёт быстрее
})

const close = () => window.electronAPI?.invoke('close-self')
</script>
