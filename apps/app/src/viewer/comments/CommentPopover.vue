<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { onClickOutside } from '@vueuse/core'
import { useFloating, offset, flip, shift, arrow, autoUpdate } from '@floating-ui/vue'
import UiIcon from '@/ui/UiIcon.vue'
import UiSwitch from '@/ui/UiSwitch.vue'
import { COMMENT_KINDS, type CommentKind } from '@/viewer/comments/commentKinds'
import { useI18n } from '@/i18n'

/**
 * Small card to create or edit a comment, pinned to an anchor point on the map via
 * floating-ui: it opens above the anchor and flips below / shifts sideways on its
 * own when there isn't room (e.g. near the top edge). The arrow always points back
 * at the anchor.
 */
const props = defineProps<{
  mode: 'create' | 'edit'
  /** Reference rect in viewport coords (vx,vy = top-left, vw,vh = size; a point is
   *  0x0); floating-ui opens the card above it and flips below it. */
  vx: number
  vy: number
  vw: number
  vh: number
  text?: string
  author?: string
  /** Visible window in seconds (defaults to 5). */
  duration?: number
  /** Human label for what the comment is anchored to (player/grenade/point). */
  anchorLabel?: string
  /** Icon name for the anchor badge. */
  anchorIcon?: string
  /** Feedback kind (defaults to note). */
  kind?: CommentKind
  /** Whether this comment is anchored to an area (enables the "text inside" toggle). */
  isArea?: boolean
  /** Area comments: draw the text inside the rectangle (defaults to false). */
  textInside?: boolean
}>()

const emit = defineEmits<{
  save: [{ text: string; author: string; duration: number; kind: CommentKind; textInside: boolean }]
  /** Emitted as the user picks a kind, so the map recolors the pending area live. */
  'update:kind': [CommentKind]
  remove: []
  close: []
}>()

const { t } = useI18n()

const text = ref(props.text ?? '')
const author = ref(props.author ?? '')
const duration = ref(props.duration ?? 5)
const kind = ref<CommentKind>(props.kind ?? 'note')
const textInside = ref(props.textInside ?? false)
const kinds = COMMENT_KINDS
function setKind(k: CommentKind) {
  kind.value = k
  emit('update:kind', k)
}
const card = ref<HTMLElement | null>(null)
const arrowEl = ref<HTMLElement | null>(null)
const textarea = ref<HTMLTextAreaElement | null>(null)

// Virtual reference rect at the anchor (viewport coords). For an area it is the
// whole selection rectangle, so the card opens above its top / flips below its
// bottom; for a point it is a 0x0 rect.
const reference = computed(() => ({
  getBoundingClientRect: () => ({
    x: props.vx,
    y: props.vy,
    width: props.vw,
    height: props.vh,
    top: props.vy,
    left: props.vx,
    right: props.vx + props.vw,
    bottom: props.vy + props.vh,
  }),
}))

const { floatingStyles, middlewareData, placement, isPositioned } = useFloating(reference, card, {
  placement: 'top',
  // 'absolute' (vs 'fixed'): the card lives inside the stage (a `relative` box), so
  // positioning against that offsetParent survives any ancestor transform/filter.
  strategy: 'absolute',
  whileElementsMounted: autoUpdate,
  middleware: [offset(12), flip({ padding: 8 }), shift({ padding: 8 }), arrow({ element: arrowEl })],
})

// Pin the arrow to the card edge that faces the anchor, so it keeps pointing at it
// after a flip (down when the card is above, up when it flipped below).
const arrowStyle = computed(() => {
  const data = middlewareData.value.arrow
  const side = placement.value.split('-')[0]
  const facing = side === 'top' ? 'bottom' : side === 'bottom' ? 'top' : side === 'left' ? 'right' : 'left'
  const style: Record<string, string> = { [facing]: '-5px' }
  if (data?.x != null) style.left = `${data.x}px`
  if (data?.y != null) style.top = `${data.y}px`
  return style
})

// Arm the click-outside only after the click that opened this popover has been
// dispatched. onClickOutside fires on `click` (capture), so that very opening
// click — which lands on the map, outside the popover — would otherwise close it
// the instant it appears.
const armed = ref(false)
// Ignore the map canvas: dragging/clicking it (pan, zoom) must not close the
// popover — it stays pinned to its anchor as the view moves.
onClickOutside(
  card,
  () => {
    if (armed.value) emit('close')
  },
  { ignore: ['[data-viewer-canvas]'] },
)

onMounted(async () => {
  await nextTick()
  textarea.value?.focus()
  requestAnimationFrame(() => {
    armed.value = true
  })
})

function save() {
  const body = text.value.trim()
  if (!body) return
  const dur = Math.max(0.5, Number(duration.value) || 5)
  emit('save', {
    text: body,
    author: author.value.trim(),
    duration: dur,
    kind: kind.value,
    textInside: textInside.value,
  })
}

// Esc closes; Cmd/Ctrl+Enter saves. stopPropagation keeps the viewer's global
// shortcuts (space, arrows) from firing while typing.
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.stopPropagation()
    emit('close')
  } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault()
    save()
  }
}
</script>

<template>
  <div
    ref="card"
    class="z-30 w-64 rounded-xl border border-ink-700 bg-ink-900/95 p-2.5 shadow-xl shadow-black/40 backdrop-blur transition-opacity duration-75"
    :style="[floatingStyles, { opacity: isPositioned ? '1' : '0' }]"
    @keydown="onKeydown"
    @pointerdown.stop
  >
    <!-- Arrow tying the card to its anchor; floating-ui keeps it pointing at it. -->
    <div
      ref="arrowEl"
      class="absolute h-2.5 w-2.5 rotate-45 bg-ink-900/95"
      :style="arrowStyle"
    />
    <div
      v-if="anchorLabel"
      class="mb-2 flex items-center gap-1.5 rounded-md bg-white/5 px-2 py-1 text-[11px] text-ink-300"
    >
      <UiIcon v-if="anchorIcon" :name="anchorIcon" class="h-3.5 w-3.5 text-ink-400" />
      <span class="truncate">{{ anchorLabel }}</span>
    </div>
    <div class="mb-2 flex items-center gap-1">
      <button
        v-for="k in kinds"
        :key="k.kind"
        type="button"
        v-tooltip="t(`viewer.comment.kind.${k.kind}`)"
        class="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md transition-colors"
        :class="kind === k.kind ? 'bg-white/10' : 'text-ink-500 hover:bg-white/5'"
        :style="kind === k.kind ? { color: k.color } : {}"
        @click="setKind(k.kind)"
      >
        <UiIcon :name="k.icon" class="h-4 w-4" />
      </button>
    </div>
    <textarea
      ref="textarea"
      v-model="text"
      rows="3"
      :placeholder="t('viewer.comment.placeholder')"
      class="w-full resize-none rounded-lg bg-ink-800 px-2.5 py-2 text-sm text-ink-50 placeholder:text-ink-500 focus:outline-none focus:ring-1 focus:ring-surge-500"
    />
    <div class="mt-2 text-xs text-ink-400">
      <div class="mb-1 flex items-center justify-between">
        <span>{{ t('viewer.comment.duration') }}</span>
        <span class="font-mono tabular-nums text-ink-200">{{ duration }}s</span>
      </div>
      <input
        v-model.number="duration"
        type="range"
        min="1"
        max="30"
        step="0.5"
        class="w-full cursor-pointer"
        :style="{ accentColor: 'var(--color-surge-500)' }"
      />
    </div>
    <label
      v-if="isArea"
      class="mt-2 flex cursor-pointer items-center justify-between gap-2 text-xs text-ink-300"
    >
      <span>{{ t('viewer.comment.textInside') }}</span>
      <UiSwitch :model-value="textInside" @update:model-value="textInside = $event" />
    </label>
    <div class="mt-2 flex items-center justify-between gap-2">
      <button
        v-if="mode === 'edit'"
        v-tooltip="t('viewer.comment.delete')"
        type="button"
        class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-ink-400 transition-colors hover:bg-red-500/15 hover:text-red-400"
        @click="emit('remove')"
      >
        <UiIcon name="trash-2" class="h-4 w-4" />
      </button>
      <div v-else />
      <div class="flex items-center gap-1.5">
        <button
          type="button"
          class="cursor-pointer rounded-lg px-3 py-1.5 text-xs text-ink-300 transition-colors hover:bg-white/5 hover:text-white"
          @click="emit('close')"
        >
          {{ t('viewer.comment.cancel') }}
        </button>
        <button
          type="button"
          :disabled="!text.trim()"
          class="cursor-pointer rounded-lg bg-surge-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-surge-400 disabled:cursor-not-allowed disabled:opacity-40"
          @click="save"
        >
          {{ t('viewer.comment.save') }}
        </button>
      </div>
    </div>
  </div>
</template>
