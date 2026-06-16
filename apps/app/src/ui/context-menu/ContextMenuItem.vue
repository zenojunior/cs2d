<script setup lang="ts">
import { computed, type HTMLAttributes } from 'vue'
import {
  ContextMenuItem,
  type ContextMenuItemEmits,
  type ContextMenuItemProps,
  useForwardPropsEmits,
} from 'reka-ui'
import { cn } from '@/ui/utils'

const props = defineProps<
  ContextMenuItemProps & { class?: HTMLAttributes['class']; inset?: boolean }
>()
const emits = defineEmits<ContextMenuItemEmits>()

const delegated = computed(() => {
  const { class: _, inset: __, ...rest } = props
  return rest
})
const forwarded = useForwardPropsEmits(delegated, emits)
</script>

<template>
  <ContextMenuItem
    v-bind="forwarded"
    :class="
      cn(
        'relative flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none transition-colors data-[highlighted]:bg-ink-800 data-[highlighted]:text-ink-50 data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        inset && 'pl-8',
        props.class,
      )
    "
  >
    <slot />
  </ContextMenuItem>
</template>
