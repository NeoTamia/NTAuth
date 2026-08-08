<script setup lang="ts">
withDefaults(
  defineProps<{
    label: string;
    lines?: number;
  }>(),
  { lines: 3 },
);
</script>

<template>
  <div class="loading-skeleton" role="status" aria-live="polite" aria-busy="true">
    <span class="sr-only">{{ label }}</span>
    <span v-for="line in lines" :key="line" class="loading-skeleton__line" aria-hidden="true" />
  </div>
</template>
