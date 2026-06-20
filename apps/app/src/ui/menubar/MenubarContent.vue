<script setup lang="ts">
import { computed, type HTMLAttributes } from 'vue'
import {
  MenubarContent,
  type MenubarContentProps,
  MenubarPortal,
  useForwardProps,
} from 'reka-ui'
import { cn } from '@/ui/utils'

const props = withDefaults(
  defineProps<MenubarContentProps & { class?: HTMLAttributes['class'] }>(),
  {
    align: 'start',
    sideOffset: 6,
  },
)

const delegated = computed(() => {
  const { class: _, ...rest } = props
  return rest
})
const forwarded = useForwardProps(delegated)
</script>

<template>
  <MenubarPortal>
    <MenubarContent
      v-bind="forwarded"
      :class="
        cn(
          'z-50 min-w-[11rem] overflow-hidden rounded-lg border border-ink-700 bg-ink-900/95 p-1 text-ink-100 shadow-xl shadow-black/50 backdrop-blur',
          props.class,
        )
      "
    >
      <slot />
    </MenubarContent>
  </MenubarPortal>
</template>
