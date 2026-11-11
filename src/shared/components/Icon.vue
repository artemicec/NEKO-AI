<template>
  <svg
    class="icon"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    v-html="path"
  />
</template>

<script setup lang="ts">
// v-html безопасен: ICON_PATHS — константы из icons.ts, пользовательского текста там нет.
import { computed } from 'vue'
import { ICON_PATHS, type IconName } from './icons'

const props = withDefaults(defineProps<{ name: IconName; size?: number }>(), { size: 18 })
const path = computed(() => ICON_PATHS[props.name])
</script>

<style scoped>
.icon { display: block; flex-shrink: 0; }
</style>
