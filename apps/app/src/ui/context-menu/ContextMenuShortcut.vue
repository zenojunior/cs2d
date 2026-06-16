<script setup lang="ts">
import { type HTMLAttributes } from 'vue'
import { cn } from '@/ui/utils'

const props = defineProps<{ class?: HTMLAttributes['class'] }>()
</script>

<template>
  <span :class="cn('ml-auto pl-4 font-mono text-xs tracking-wider text-ink-500', props.class)">
    <slot />
  </span>
</template>
