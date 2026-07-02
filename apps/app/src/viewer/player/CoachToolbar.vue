<script setup lang="ts">
import { ref } from 'vue'
import { onClickOutside } from '@vueuse/core'
import UiIcon from '@/ui/UiIcon.vue'
import {
  type CoachTool,
  COACH_COLORS,
  COACH_GRENADE_KINDS,
  COACH_THICKNESSES,
  COACH_TOOL_ICON,
} from '@/viewer/player/coachTools'
import type { GrenadeKind } from '@/viewer/domain/schema'
import { useI18n } from '@/app/i18n'

const { t } = useI18n()

const props = defineProps<{
  tool: CoachTool
  color: string
  thickness: number
  grenadeKind: GrenadeKind
  canUndo: boolean
  canRedo: boolean
}>()

const emit = defineEmits<{
  setTool: [tool: CoachTool]
  setColor: [color: string]
  setThickness: [thickness: number]
  setGrenadeKind: [kind: GrenadeKind]
  undo: []
  redo: []
  clear: []
  exit: []
}>()

// The drawing tools, in toolbar order. `select` edits/moves existing shapes.
const TOOLS: { tool: CoachTool; label: string }[] = [
  { tool: 'select', label: t('viewer.coach.tool.select') },
  { tool: 'rectangle', label: t('viewer.coach.tool.rectangle') },
  { tool: 'circle', label: t('viewer.coach.tool.circle') },
  { tool: 'arrow', label: t('viewer.coach.tool.arrow') },
  { tool: 'path', label: t('viewer.coach.tool.path') },
]

// Grenade kind -> white icon SVG under /public/weapons.
const GRENADE_ICON: Record<GrenadeKind, string> = {
  smoke: 'smoke',
  fire: 'molotov',
  he: 'he',
  flash: 'flash',
  decoy: 'decoy',
}

// Grenade tool: a button that selects the tool and opens a kind picker.
const grenadeOpen = ref(false)
const grenadeMenu = ref<HTMLElement | null>(null)
onClickOutside(grenadeMenu, () => (grenadeOpen.value = false))
function pickGrenade(kind: GrenadeKind) {
  emit('setGrenadeKind', kind)
  emit('setTool', 'grenade')
  grenadeOpen.value = false
}
function onGrenadeButton() {
  emit('setTool', 'grenade')
  grenadeOpen.value = !grenadeOpen.value
}

// Color and thickness pickers: small popovers anchored to their swatch button.
const colorOpen = ref(false)
const colorMenu = ref<HTMLElement | null>(null)
onClickOutside(colorMenu, () => (colorOpen.value = false))
function pickColor(c: string) {
  emit('setColor', c)
  colorOpen.value = false
}

const thicknessOpen = ref(false)
const thicknessMenu = ref<HTMLElement | null>(null)
onClickOutside(thicknessMenu, () => (thicknessOpen.value = false))
function pickThickness(w: number) {
  emit('setThickness', w)
  thicknessOpen.value = false
}
</script>

<template>
  <div class="flex items-center gap-1 rounded-full border border-ink-700 bg-ink-900/90 px-1.5 py-1 backdrop-blur">
    <!-- Tools -->
    <button
      v-for="ttl in TOOLS"
      :key="ttl.tool"
      type="button"
      v-tooltip="ttl.label"
      class="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full transition-colors duration-150"
      :class="
        tool === ttl.tool
          ? 'bg-surge-500 text-white'
          : 'text-ink-200 hover:bg-white/10 hover:text-white'
      "
      @click="emit('setTool', ttl.tool)"
    >
      <UiIcon :name="COACH_TOOL_ICON[ttl.tool]" class="h-5 w-5" />
    </button>

    <!-- Grenade tool: places a grenade of the chosen kind; opens a kind picker -->
    <div ref="grenadeMenu" class="relative">
      <button
        type="button"
        v-tooltip="t('viewer.coach.tool.grenade')"
        class="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full transition-colors duration-150"
        :class="
          tool === 'grenade'
            ? 'bg-surge-500'
            : 'text-ink-200 hover:bg-white/10 hover:text-white'
        "
        @click="onGrenadeButton"
      >
        <img :src="`/weapons/${GRENADE_ICON[props.grenadeKind]}.svg`" :alt="t(`grenadeKind.${props.grenadeKind}`)" class="h-5 w-5 object-contain" />
      </button>
      <div
        v-if="grenadeOpen"
        class="absolute bottom-full left-1/2 mb-2 flex -translate-x-1/2 gap-1 rounded-lg border border-ink-700 bg-ink-900/95 p-1.5 backdrop-blur"
      >
        <button
          v-for="k in COACH_GRENADE_KINDS"
          :key="k"
          type="button"
          v-tooltip="t(`grenadeKind.${k}`)"
          class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md transition-colors"
          :class="k === props.grenadeKind ? 'bg-white/15' : 'hover:bg-white/10'"
          @click="pickGrenade(k)"
        >
          <img :src="`/weapons/${GRENADE_ICON[k]}.svg`" :alt="t(`grenadeKind.${k}`)" class="h-5 w-5 object-contain" />
        </button>
      </div>
    </div>

    <span class="mx-1 h-6 w-px bg-ink-700" />

    <!-- Color -->
    <div ref="colorMenu" class="relative">
      <button
        type="button"
        v-tooltip="t('viewer.coach.color')"
        class="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full transition-colors duration-150 hover:bg-white/10"
        @click="colorOpen = !colorOpen"
      >
        <span class="h-5 w-5 rounded-full ring-2 ring-white/30" :style="{ backgroundColor: color }" />
      </button>
      <div
        v-if="colorOpen"
        class="absolute bottom-full left-1/2 mb-2 flex -translate-x-1/2 gap-1.5 rounded-lg border border-ink-700 bg-ink-900/95 p-2 backdrop-blur"
      >
        <button
          v-for="c in COACH_COLORS"
          :key="c"
          type="button"
          class="h-6 w-6 cursor-pointer rounded-full transition-transform hover:scale-110"
          :class="c === color ? 'ring-2 ring-white' : 'ring-1 ring-white/20'"
          :style="{ backgroundColor: c }"
          @click="pickColor(c)"
        />
      </div>
    </div>

    <!-- Thickness -->
    <div ref="thicknessMenu" class="relative">
      <button
        type="button"
        v-tooltip="t('viewer.coach.thickness')"
        class="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-ink-200 transition-colors duration-150 hover:bg-white/10 hover:text-white"
        @click="thicknessOpen = !thicknessOpen"
      >
        <span class="rounded-full bg-current" :style="{ width: thickness + 2 + 'px', height: thickness + 2 + 'px' }" />
      </button>
      <div
        v-if="thicknessOpen"
        class="absolute bottom-full left-1/2 mb-2 flex -translate-x-1/2 flex-col items-center gap-2 rounded-lg border border-ink-700 bg-ink-900/95 p-2 backdrop-blur"
      >
        <button
          v-for="w in COACH_THICKNESSES"
          :key="w"
          type="button"
          class="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md transition-colors"
          :class="w === thickness ? 'bg-white/15' : 'hover:bg-white/10'"
          @click="pickThickness(w)"
        >
          <span class="rounded-full bg-ink-100" :style="{ width: w + 2 + 'px', height: w + 2 + 'px' }" />
        </button>
      </div>
    </div>

    <span class="mx-1 h-6 w-px bg-ink-700" />

    <!-- Undo / Redo (also on Ctrl+Z / Ctrl+Shift+Z) -->
    <button
      type="button"
      v-tooltip="t('viewer.coach.undo')"
      :disabled="!canUndo"
      class="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-ink-200 transition-colors duration-150 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
      @click="emit('undo')"
    >
      <UiIcon name="undo" class="h-5 w-5" />
    </button>
    <button
      type="button"
      v-tooltip="t('viewer.coach.redo')"
      :disabled="!canRedo"
      class="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-ink-200 transition-colors duration-150 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
      @click="emit('redo')"
    >
      <UiIcon name="redo" class="h-5 w-5" />
    </button>

    <span class="mx-1 h-6 w-px bg-ink-700" />

    <!-- Clear all drawings on this round -->
    <button
      type="button"
      v-tooltip="t('viewer.coach.clear')"
      class="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-ink-200 transition-colors duration-150 hover:bg-white/10 hover:text-white"
      @click="emit('clear')"
    >
      <UiIcon name="trash-2" class="h-5 w-5" />
    </button>

    <!-- Exit coach mode -->
    <button
      type="button"
      v-tooltip="t('viewer.coach.exit')"
      class="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-ink-200 transition-colors duration-150 hover:bg-white/10 hover:text-white"
      @click="emit('exit')"
    >
      <UiIcon name="log-out" class="h-5 w-5" />
    </button>
  </div>
</template>
