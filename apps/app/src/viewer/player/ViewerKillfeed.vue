<script setup lang="ts">
import { computed } from 'vue'
import type { GameEvent, PlayerMeta, Round, Side } from '@/viewer/domain/schema'
import { SIDE_COLOR } from '@/viewer/domain/colors'
import { killWeaponIcon } from '@/viewer/domain/weaponIcons'
import { useI18n } from '@/i18n'

const { t } = useI18n()

type Kill = Extract<GameEvent, { type: 'kill' }>

const props = defineProps<{
  round: Round | null
  currentT: number
  playersById: Map<string, PlayerMeta>
  sideById: Map<string, Side>
  max?: number
}>()

const kills = computed<Kill[]>(() => {
  const evs = (props.round?.events ?? []).filter(
    (e): e is Kill => e.type === 'kill' && e.t <= props.currentT,
  )
  return evs.slice(-(props.max ?? 5))
})

const nameOf = (id: string | null) => (id ? (props.playersById.get(id)?.name ?? '') : '')
const colorOf = (id: string | null) =>
  id && props.sideById.get(id) ? SIDE_COLOR[props.sideById.get(id)!] : '#8a93a6'
</script>

<template>
  <div class="flex flex-col items-end gap-1">
    <div
      v-for="(k, i) in kills"
      :key="k.tick + '-' + i"
      class="flex items-center gap-1.5 rounded-md bg-ink-950/75 px-2 py-1 text-xs backdrop-blur"
    >
      <!-- Killer first, then assister (CS2 killfeed order): killer + assister.
           The `+` (and a non-flash assist) take the team color — killer and
           assister are always teammates. -->
      <span
        v-if="k.attackerSteamId"
        class="font-medium"
        :style="{ color: colorOf(k.attackerSteamId) }"
      >
        {{ nameOf(k.attackerSteamId) }}
      </span>

      <template v-if="k.assisterSteamId">
        <img
          v-if="k.assistedFlash"
          v-tooltip="t('viewer.flashAssist')"
          src="/weapons/flash.svg"
          alt="+"
          class="h-3 w-3 opacity-90"
        />
        <span v-else class="font-medium" :style="{ color: colorOf(k.attackerSteamId) }">+</span>
        <span class="font-medium" :style="{ color: colorOf(k.assisterSteamId) }">
          {{ nameOf(k.assisterSteamId) }}
        </span>
      </template>
      <img
        v-if="killWeaponIcon(k.weapon)"
        :src="killWeaponIcon(k.weapon)!"
        :alt="k.weapon"
        class="h-3 w-6 object-contain opacity-90"
      />
      <span v-else class="text-ink-400">{{ k.weapon }}</span>
      <img
        v-if="k.headshot"
        v-tooltip="t('viewer.headshot')"
        src="/weapons/headshot.svg"
        alt="Headshot"
        class="h-3.5 w-3.5"
      />
      <span class="font-medium" :style="{ color: colorOf(k.victimSteamId) }">
        {{ nameOf(k.victimSteamId) }}
      </span>
    </div>
  </div>
</template>
