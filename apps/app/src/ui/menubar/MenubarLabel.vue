<script setup lang="ts">
import { computed, type HTMLAttributes } from 'vue'
import { MenubarLabel, type MenubarLabelProps, useForwardProps } from 'reka-ui'
import { cn } from '@/ui/utils'

const props = defineProps<MenubarLabelProps & { class?: HTMLAttributes['class']; inset?: boolean }>()

const delegated = computed(() => {
  const { class: _, inset: __, ...rest } = props
  return rest
})
const forwarded = useForwardProps(delegated)
</script>

<template>
  <MenubarLabel
    v-bind="forwarded"
    :class="cn('px-2 py-1.5 text-xs font-medium text-ink-400', inset && 'pl-8', props.class)"
  >
    <slot />
  </MenubarLabel>
</template>
