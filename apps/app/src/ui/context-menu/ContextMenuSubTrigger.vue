<script setup lang="ts">
import { computed, type HTMLAttributes } from 'vue'
import {
  ContextMenuSubTrigger,
  type ContextMenuSubTriggerProps,
  useForwardProps,
} from 'reka-ui'
import { cn } from '@/ui/utils'

const props = defineProps<
  ContextMenuSubTriggerProps & { class?: HTMLAttributes['class']; inset?: boolean }
>()

const delegated = computed(() => {
  const { class: _, inset: __, ...rest } = props
  return rest
})
const forwarded = useForwardProps(delegated)
</script>

<template>
  <ContextMenuSubTrigger
    v-bind="forwarded"
    :class="
      cn(
        'flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none transition-colors data-[highlighted]:bg-ink-800 data-[highlighted]:text-ink-50 data-[state=open]:bg-ink-800 data-[state=open]:text-ink-50',
        inset && 'pl-8',
        props.class,
      )
    "
  >
    <slot />
    <svg
      class="ml-auto h-3.5 w-3.5 text-ink-400"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  </ContextMenuSubTrigger>
</template>
