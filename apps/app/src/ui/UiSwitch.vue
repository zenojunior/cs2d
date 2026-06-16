<script setup lang="ts">
defineProps<{ modelValue?: boolean; disabled?: boolean; label?: string }>()
defineEmits<{ 'update:modelValue': [value: boolean] }>()
</script>

<template>
  <label
    class="inline-flex items-center gap-2.5"
    :class="disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'"
  >
    <button
      type="button"
      role="switch"
      :aria-checked="modelValue"
      :disabled="disabled"
      class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-surge-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900"
      :class="modelValue ? 'bg-surge-500' : 'bg-ink-600'"
      @click="$emit('update:modelValue', !modelValue)"
    >
      <span
        class="inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200"
        :class="modelValue ? 'translate-x-[22px]' : 'translate-x-[2px]'"
      />
    </button>
    <span v-if="label" class="select-none text-sm text-ink-100">{{ label }}</span>
  </label>
</template>
