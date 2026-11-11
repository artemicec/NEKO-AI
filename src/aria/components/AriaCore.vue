<template>
  <div class="aria-core" :data-state="state" role="img" :aria-label="label">
    <div class="core-iris"></div>
    <div class="core-blades">
      <i v-for="n in 8" :key="n" class="core-wrap" :style="{ '--i': n - 1 }"><b class="core-blade"></b></i>
    </div>
    <div class="core-barrel"></div>
  </div>
</template>

<script setup lang="ts">
// Объектив ARIA: 8 лепестков диафрагмы раскрываются и закрываются в зависимости от того, что она делает.
// В шапке — маленький индикатор состояния; если модели нет — большой, в центре экрана.
// Только transform/opacity — анимация идёт на видеокарте. Стили — в styles/aria.css (блок «Объектив»).
import type { CoreState } from '../types'

defineProps<{ state: CoreState; label?: string }>()
</script>
