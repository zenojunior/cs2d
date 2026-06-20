<script setup lang="ts">
import { computed, type HTMLAttributes } from 'vue'
import { MenubarTrigger, type MenubarTriggerProps, useForwardProps } from 'reka-ui'
import { cn } from '@/ui/utils'

const props = defineProps<MenubarTriggerProps & { class?: HTMLAttributes['class'] }>()

const delegated = computed(() => {
  const { class: _, ...rest } = props
  return rest
})
const forwarded = useForwardProps(delegated)
</script>

<template>
  <MenubarTrigger
    v-bind="forwarded"
    :class="
      cn(
        'flex cursor-pointer select-none items-center gap-1.5 rounded-md border border-ink-700 bg-ink-900/60 px-2 py-1 text-xs font-medium text-ink-200 outline-none transition-colors hover:bg-ink-800 data-[highlighted]:bg-ink-800 data-[state=open]:bg-ink-800',
        props.class,
      )
    "
  >
    <slot />
  </MenubarTrigger>
</template>
