<script setup lang="ts">
import { type HTMLAttributes } from 'vue'
import { MenubarSeparator, type MenubarSeparatorProps } from 'reka-ui'
import { cn } from '@/ui/utils'

const props = defineProps<MenubarSeparatorProps & { class?: HTMLAttributes['class'] }>()
</script>

<template>
  <MenubarSeparator
    :as-child="props.asChild"
    :as="props.as"
    :class="cn('-mx-1 my-1 h-px bg-ink-700', props.class)"
  />
</template>
