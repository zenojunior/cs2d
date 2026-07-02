<script setup lang="ts">
import { computed } from 'vue'
import { killWeaponIcon } from '@/viewer/domain/weaponIcons'
import { useI18n } from '@/app/i18n'

const { t } = useI18n()

/**
 * A single killfeed row: killer [+ assister] [flash] weapon [HS] victim, each
 * name colored by its side. Only the row content, so callers own the surrounding
 * chrome (the in-stage badge, a popover button, ...). Shared by `ViewerKillfeed`
 * and any panel that wants the same kill representation (e.g. the opening duels).
 */
defineProps<{
  attackerName: string | null
  attackerColor: string
  /** Assister (CS2 killfeed shows it right after the killer with a `+`). */
  assisterName?: string | null
  assisterColor?: string
  /** The assist came from a flashbang (adds the flash icon). */
  assistedFlash?: boolean
  weapon: string
  headshot: boolean
  victimName: string
  victimColor: string
  /** Ellipsize long names (with the full name on hover). For constrained rows
   *  like the opening-duel list; the in-stage feed leaves names full. */
  truncateNames?: boolean
}>()
</script>

<template>
  <div class="flex items-center gap-1.5 text-xs">
    <!-- Killer, then assister (CS2 killfeed order). The `+` takes the killer's
         team color; a flash assist adds the flash icon right after it. -->
    <span
      v-if="attackerName"
      class="font-medium"
      :class="truncateNames ? 'min-w-0 truncate' : ''"
      :style="{ color: attackerColor }"
      :title="truncateNames ? attackerName : undefined"
      >{{ attackerName }}</span
    >
    <template v-if="assisterName">
      <span class="font-medium" :style="{ color: attackerColor }">+</span>
      <img
        v-if="assistedFlash"
        v-tooltip="t('viewer.flashAssist')"
        src="/weapons/flash.svg"
        alt="flash assist"
        class="h-3 w-3 opacity-90"
      />
      <span class="font-medium" :style="{ color: assisterColor }">{{ assisterName }}</span>
    </template>
    <img
      v-if="killWeaponIcon(weapon)"
      :src="killWeaponIcon(weapon)!"
      :alt="weapon"
      class="h-3 w-6 shrink-0 object-contain opacity-90"
    />
    <span v-else class="text-ink-400">{{ weapon }}</span>
    <img
      v-if="headshot"
      v-tooltip="t('viewer.headshot')"
      src="/weapons/headshot.svg"
      alt="Headshot"
      class="h-3.5 w-3.5 shrink-0"
    />
    <span
      class="font-medium"
      :class="truncateNames ? 'min-w-0 truncate' : ''"
      :style="{ color: victimColor }"
      :title="truncateNames ? victimName : undefined"
      >{{ victimName }}</span
    >
  </div>
</template>
