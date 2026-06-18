<script setup lang="ts">
import { computed, ref } from 'vue'
import type { CommentKind, PlayerMeta, ReplayComment } from '@/viewer/schema'
import UiIcon from '@/ui/UiIcon.vue'
import UiSwitch from '@/ui/UiSwitch.vue'
import { useI18n } from '@/i18n'
import { commentDuration } from '@/viewer/commentAnchor'
import { COMMENT_KINDS } from '@/viewer/commentKinds'

/**
 * Side drawer listing every comment in the demo, grouped by round (each group is
 * collapsible). Inline editing (text/author/duration), jump-to and delete. The
 * reactive list lives in `useComments`; this is a controlled view that emits
 * changes back to the stage.
 */
const props = defineProps<{
  comments: ReplayComment[]
  roundLabels: string[]
  playersById: Map<string, PlayerMeta>
}>()

const emit = defineEmits<{
  update: [
    { id: string; text?: string; author?: string; duration?: number; kind?: CommentKind; textInside?: boolean },
  ]
  remove: [id: string]
  jump: [{ roundIndex: number; t: number }]
  close: []
}>()

const { t } = useI18n()
const kinds = COMMENT_KINDS

/** Comments grouped by round (round order); each group sorted by time. */
const groups = computed(() => {
  const map = new Map<number, ReplayComment[]>()
  const sorted = [...props.comments].sort((a, b) => a.roundIndex - b.roundIndex || a.t - b.t)
  for (const c of sorted) {
    const arr = map.get(c.roundIndex) ?? []
    arr.push(c)
    map.set(c.roundIndex, arr)
  }
  return [...map.entries()].map(([roundIndex, comments]) => ({ roundIndex, comments }))
})

// Collapsed round groups (by round index).
const collapsed = ref<Set<number>>(new Set())
function toggleRound(roundIndex: number) {
  const next = new Set(collapsed.value)
  next.has(roundIndex) ? next.delete(roundIndex) : next.add(roundIndex)
  collapsed.value = next
}

function fmt(s: number) {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

function roundLabel(i: number): string {
  return props.roundLabels[i] ?? String(i + 1)
}

function anchorLabel(c: ReplayComment): string {
  const a = c.anchor
  if (a?.kind === 'player') return props.playersById.get(a.steamId)?.name ?? t('viewer.comment.targetPlayer')
  if (a?.kind === 'grenade') return t(`grenadeKind.${a.grenadeKind}`)
  if (a?.kind === 'area') return t('viewer.comment.targetArea')
  return t('viewer.comment.targetPoint')
}

function anchorIcon(c: ReplayComment): string {
  const k = c.anchor?.kind
  return k === 'player' ? 'user' : k === 'grenade' ? 'flame' : k === 'area' ? 'square' : 'map-pin'
}
</script>

<template>
  <div
    class="pointer-events-auto absolute inset-y-0 right-0 z-30 flex w-80 max-w-[85vw] flex-col border-l border-ink-700 bg-ink-900/95 backdrop-blur"
  >
    <header class="flex items-center justify-between border-b border-ink-700 px-4 py-3">
      <h3 class="flex items-center gap-2 text-sm font-semibold text-ink-100">
        <UiIcon name="message" class="h-4 w-4 text-ink-400" />
        {{ t('viewer.comment.panelTitle') }}
        <span class="font-mono text-xs text-ink-500">{{ comments.length }}</span>
      </h3>
      <button
        type="button"
        class="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-ink-400 transition-colors hover:bg-white/10 hover:text-white"
        @click="emit('close')"
      >
        <UiIcon name="x" class="h-4 w-4" />
      </button>
    </header>

    <div
      v-if="!comments.length"
      class="flex flex-1 items-center justify-center p-6 text-center text-sm text-ink-500"
    >
      {{ t('viewer.comment.empty') }}
    </div>

    <div v-else class="flex-1 overflow-y-auto p-3">
      <section v-for="g in groups" :key="g.roundIndex" class="mb-3">
        <!-- Round group header (collapsible) -->
        <button
          type="button"
          class="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs font-semibold text-ink-200 transition-colors hover:bg-white/5"
          @click="toggleRound(g.roundIndex)"
        >
          <UiIcon
            name="chevron-down"
            class="h-3.5 w-3.5 text-ink-500 transition-transform"
            :class="{ '-rotate-90': collapsed.has(g.roundIndex) }"
          />
          {{ t('viewer.round') }} {{ roundLabel(g.roundIndex) }}
          <span class="ml-auto font-mono text-ink-500">{{ g.comments.length }}</span>
        </button>

        <ul v-show="!collapsed.has(g.roundIndex)" class="mt-1.5 space-y-2">
          <li
            v-for="c in g.comments"
            :key="c.id"
            class="rounded-lg border border-ink-800 bg-ink-850/60 p-2.5"
          >
            <div class="mb-1.5 flex items-center gap-2 text-[11px] text-ink-400">
              <button
                type="button"
                v-tooltip="t('viewer.comment.jump')"
                class="flex cursor-pointer items-center gap-1 rounded bg-white/5 px-1.5 py-0.5 font-mono text-ink-200 transition-colors hover:bg-white/10 hover:text-white"
                @click="emit('jump', { roundIndex: c.roundIndex, t: c.t })"
              >
                {{ fmt(c.t) }}
              </button>
              <span class="flex min-w-0 items-center gap-1 truncate">
                <UiIcon :name="anchorIcon(c)" class="h-3 w-3 shrink-0" />
                <span class="truncate">{{ anchorLabel(c) }}</span>
              </span>
              <button
                type="button"
                v-tooltip="t('viewer.comment.delete')"
                class="ml-auto flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded text-ink-500 transition-colors hover:bg-red-500/15 hover:text-red-400"
                @click="emit('remove', c.id)"
              >
                <UiIcon name="trash-2" class="h-3.5 w-3.5" />
              </button>
            </div>
            <textarea
              :value="c.text"
              rows="2"
              class="w-full resize-none rounded-md bg-ink-800 px-2 py-1.5 text-sm text-ink-50 focus:outline-none focus:ring-1 focus:ring-surge-500"
              @input="emit('update', { id: c.id, text: ($event.target as HTMLTextAreaElement).value })"
            />
            <input
              :value="c.author ?? ''"
              type="text"
              :placeholder="t('viewer.comment.authorPlaceholder')"
              class="mt-1.5 w-full rounded-md bg-ink-800 px-2 py-1 text-xs text-ink-100 placeholder:text-ink-500 focus:outline-none focus:ring-1 focus:ring-surge-500"
              @input="emit('update', { id: c.id, author: ($event.target as HTMLInputElement).value })"
            />
            <div class="mt-1.5 flex items-center gap-2 text-xs text-ink-400">
              <span class="shrink-0">{{ t('viewer.comment.duration') }}</span>
              <input
                :value="commentDuration(c)"
                type="range"
                min="1"
                max="30"
                step="0.5"
                class="min-w-0 flex-1 cursor-pointer"
                :style="{ accentColor: 'var(--color-surge-500)' }"
                @input="emit('update', { id: c.id, duration: Number(($event.target as HTMLInputElement).value) })"
              />
              <span class="w-9 shrink-0 text-right font-mono tabular-nums text-ink-200">
                {{ commentDuration(c) }}s
              </span>
            </div>
            <div class="mt-1.5 flex items-center gap-0.5">
              <button
                v-for="k in kinds"
                :key="k.kind"
                type="button"
                v-tooltip="t(`viewer.comment.kind.${k.kind}`)"
                class="flex h-6 w-6 cursor-pointer items-center justify-center rounded transition-colors"
                :class="(c.kind ?? 'note') === k.kind ? 'bg-white/10' : 'text-ink-600 hover:bg-white/5'"
                :style="(c.kind ?? 'note') === k.kind ? { color: k.color } : {}"
                @click="emit('update', { id: c.id, kind: k.kind })"
              >
                <UiIcon :name="k.icon" class="h-3.5 w-3.5" />
              </button>
            </div>
            <label
              v-if="c.anchor?.kind === 'area'"
              class="mt-1.5 flex cursor-pointer items-center justify-between gap-2 text-xs text-ink-400"
            >
              <span>{{ t('viewer.comment.textInside') }}</span>
              <UiSwitch
                :model-value="c.textInside ?? false"
                @update:model-value="emit('update', { id: c.id, textInside: $event })"
              />
            </label>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
