<script setup lang="ts">
import { computed } from 'vue'
import type { PlayerMeta, PlayerState, Side } from '@/viewer/domain/schema'
import { SIDE_COLOR } from '@/viewer/domain/colors'
import { weaponIconPath } from '@/viewer/domain/weaponIcons'
import { useI18n } from '@/i18n'

const { t } = useI18n()

const props = withDefaults(
  defineProps<{
    players: PlayerState[]
    playersById: Map<string, PlayerMeta>
    score: Record<Side, number>
    hideScore?: boolean
    /** Render only this side (one team per corner). */
    side?: Side
    /** Mirror the content, for the right corner. */
    align?: 'left' | 'right'
    /** steamId of the player being followed (highlights its card). */
    selectedId?: string | null
  }>(),
  { align: 'left' },
)

const emit = defineEmits<{
  /** A player card was clicked (toggles follow on the map). */
  select: [steamId: string]
}>()

const sides = computed<{ side: Side; label: string }[]>(() =>
  props.side
    ? [{ side: props.side, label: props.side }]
    : [
        { side: 'CT', label: 'CT' },
        { side: 'T', label: 'T' },
      ],
)

const mirror = computed(() => props.align === 'right')

function roster(side: Side) {
  return props.players
    .filter((p) => p.side === side)
    .map((p) => ({ ...p, name: props.playersById.get(p.steamId)?.name ?? '?' }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

const armorIcon = (p: PlayerState) =>
  p.armor > 0 ? (p.helmet ? '/weapons/vesthelm.svg' : '/weapons/vest.svg') : null
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- Score (rounds won per side) -->
    <div
      v-if="!hideScore"
      class="flex items-center justify-center gap-3 font-mono text-2xl"
    >
      <span class="tabular-nums" :style="{ color: SIDE_COLOR.CT }">{{ score.CT }}</span>
      <span class="text-ink-500">:</span>
      <span class="tabular-nums" :style="{ color: SIDE_COLOR.T }">{{ score.T }}</span>
    </div>

    <div v-for="s in sides" :key="s.side" class="flex flex-col gap-1.5">
      <div
        v-for="p in roster(s.side)"
        :key="p.steamId"
        class="flex cursor-pointer flex-col gap-1 rounded-md border bg-ink-800 px-2.5 py-1.5 transition-colors"
        :class="[
          { 'opacity-45': !p.alive },
          p.steamId === selectedId
            ? 'border-surge-400 ring-1 ring-surge-400'
            : 'border-ink-700 hover:border-ink-500',
        ]"
        @click="emit('select', p.steamId)"
      >
        <div class="flex items-center gap-2" :class="mirror && 'flex-row-reverse'">
          <span
            class="min-w-0 flex-1 truncate text-sm text-ink-100"
            :class="mirror && 'text-right'"
          >
            {{ p.name }}
          </span>
          <span class="w-7 font-mono text-xs text-ink-300 tabular-nums" :class="mirror ? 'text-left' : 'text-right'">
            {{ p.alive ? p.health : 0 }}
          </span>
          <span class="font-mono text-[0.7rem] tabular-nums text-win">${{ p.money }}</span>
        </div>

        <div class="h-1 overflow-hidden rounded-full bg-ink-700">
          <div
            class="h-full rounded-full transition-all duration-200"
            :style="{ width: `${p.alive ? p.health : 0}%`, backgroundColor: SIDE_COLOR[s.side] }"
          />
        </div>

        <div
          v-if="p.alive"
          class="flex h-4 items-center gap-1"
          :class="mirror && 'flex-row-reverse'"
        >
          <img
            v-if="weaponIconPath(p.weapon)"
            :src="weaponIconPath(p.weapon)!"
            :alt="p.weapon"
            class="h-3.5 w-6 shrink-0 object-contain opacity-90"
            :class="mirror ? 'object-right' : 'object-left'"
          />
          <img
            v-for="(g, i) in p.grenades ?? []"
            :key="i"
            :src="weaponIconPath(g) ?? ''"
            :alt="g"
            class="h-3 w-3 shrink-0 object-contain opacity-90"
          />
          <img
            v-if="p.defuser"
            v-tooltip="t('viewer.defuseKit')"
            src="/weapons/defuse.svg"
            alt="Kit"
            class="h-3.5 w-3.5 shrink-0 object-contain opacity-90"
          />
          <img
            v-if="armorIcon(p)"
            v-tooltip="p.helmet ? t('viewer.vestHelmet') : t('viewer.vest')"
            :src="armorIcon(p)!"
            alt="Colete"
            class="h-3.5 w-3 shrink-0 object-contain opacity-80"
          />
        </div>
        <div
          v-else
          class="text-[0.65rem] text-ink-500"
          :class="mirror && 'text-right'"
        >
          {{ t('viewer.eliminated') }}
        </div>
      </div>
    </div>
  </div>
</template>
