<script setup lang="ts">
import { computed, type HTMLAttributes } from 'vue'
import {
  ContextMenuPortal,
  ContextMenuSubContent,
  type ContextMenuSubContentEmits,
  type ContextMenuSubContentProps,
  useForwardPropsEmits,
} from 'reka-ui'
import { cn } from '@/ui/utils'

const props = defineProps<ContextMenuSubContentProps & { class?: HTMLAttributes['class'] }>()
const emits = defineEmits<ContextMenuSubContentEmits>()

const delegated = computed(() => {
  const { class: _, ...rest } = props
  return rest
})
const forwarded = useForwardPropsEmits(delegated, emits)
</script>

<template>
  <ContextMenuPortal>
    <ContextMenuSubContent
      v-bind="forwarded"
      :class="
        cn(
          'z-50 min-w-[8rem] overflow-hidden rounded-lg border border-ink-700 bg-ink-900/95 p-1 text-ink-100 shadow-xl shadow-black/50 backdrop-blur',
          props.class,
        )
      "
    >
      <slot />
    </ContextMenuSubContent>
  </ContextMenuPortal>
</template>
