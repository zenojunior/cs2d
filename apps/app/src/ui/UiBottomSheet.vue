<script setup lang="ts">
import { DialogRoot, DialogPortal, DialogOverlay, DialogContent, DialogTitle, DialogDescription } from 'reka-ui'

/**
 * Bottom sheet: a reka-ui dialog pinned to the bottom edge that slides up over a
 * dimmed overlay, capped at 85vh. Generic chrome only — the caller fills the
 * default slot with the header and body (and any `DialogClose`). `title` feeds the
 * accessible, visually-hidden DialogTitle/Description; render a visible heading in
 * the slot. Animations live in `style.css` (`sheet-slide-*`, `overlay-fade-*`).
 */
defineProps<{ open: boolean; title: string }>()
const emit = defineEmits<{ 'update:open': [boolean] }>()
</script>

<template>
  <DialogRoot :open="open" @update:open="(v) => emit('update:open', v)">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-[overlay-fade-in_150ms_ease-out] data-[state=closed]:animate-[overlay-fade-out_180ms_ease-in]" />
      <DialogContent
        class="fixed inset-x-0 bottom-0 z-50 flex max-h-[85vh] flex-col rounded-t-2xl border-t border-ink-700 bg-ink-900 shadow-2xl shadow-black/60 focus:outline-none data-[state=open]:animate-[sheet-slide-up_220ms_ease-out] data-[state=closed]:animate-[sheet-slide-down_180ms_ease-in]"
      >
        <DialogTitle class="sr-only">{{ title }}</DialogTitle>
        <DialogDescription class="sr-only">{{ title }}</DialogDescription>
        <slot />
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
