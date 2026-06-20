<script setup lang="ts">
import { computed, type HTMLAttributes } from 'vue'
import {
  MenubarRoot,
  type MenubarRootEmits,
  type MenubarRootProps,
  useForwardPropsEmits,
} from 'reka-ui'
import { cn } from '@/ui/utils'

const props = defineProps<MenubarRootProps & { class?: HTMLAttributes['class'] }>()
const emits = defineEmits<MenubarRootEmits>()

const delegated = computed(() => {
  const { class: _, ...rest } = props
  return rest
})
const forwarded = useForwardPropsEmits(delegated, emits)
</script>

<template>
  <MenubarRoot v-bind="forwarded" :class="cn('flex items-center gap-1', props.class)">
    <slot />
  </MenubarRoot>
</template>
