<script setup lang="ts">
// The replay's right-click context menu content: comment actions (edit/delete)
// when the click landed on a comment, target actions (follow / add comment /
// copy setpos) when it landed on a player, then the always-present transport
// (play/seek), speed submenu and round picker. Split out of ViewerStage; the
// comment/target state and the comment actions are owned by the stage.
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '@/ui/context-menu'
import UiIcon from '@/ui/UiIcon.vue'
import type { CommentAnchor } from '@/viewer/domain/schema'
import { SIDE_COLOR } from '@/viewer/domain/colors'
import { roundOutcome } from '@/viewer/domain/roundOutcome'
import { useReplay, SPEEDS } from '@/viewer/player/useReplay'
import { useI18n } from '@/app/i18n'

const props = defineProps<{
  r: ReturnType<typeof useReplay>
  contextComment: { id: string; vx: number; vy: number; vw: number; vh: number } | null
  contextTarget: {
    x: number
    y: number
    z: number
    yaw: number
    anchor: CommentAnchor
    vx: number
    vy: number
  } | null
  contextPlayerId: string | null
  followSteamId: string | null
  /** Human label for the right-clicked target (player name / grenade / point). */
  anchorLabel: (anchor: CommentAnchor) => string
}>()

const emit = defineEmits<{
  editComment: []
  deleteComment: []
  followPlayer: []
  addComment: []
  copySetpos: []
}>()

const { t } = useI18n()

// Color of the side that won the round (for the Rounds menu); neutral if none.
function roundWinnerColor(i: number): string {
  const winner = props.r.replay.value?.rounds[i]?.winner
  return winner ? SIDE_COLOR[winner] : 'var(--color-ink-600)'
}

// Round outcome icon (bomb, defuse, elimination, time).
function roundOutcomeFor(i: number) {
  return roundOutcome(props.r.replay.value?.rounds[i]?.reason ?? null)
}
</script>

<template>
  <ContextMenuContent class="w-60">
    <!-- Comment actions, shown when the right-click landed on a comment -->
    <template v-if="contextComment">
      <ContextMenuItem @select="emit('editComment')">
        <UiIcon name="pencil" class="h-4 w-4 text-ink-400" />
        {{ t('viewer.comment.edit') }}
      </ContextMenuItem>
      <ContextMenuItem @select="emit('deleteComment')">
        <UiIcon name="trash-2" class="h-4 w-4 text-ink-400" />
        {{ t('viewer.comment.delete') }}
      </ContextMenuItem>
      <ContextMenuSeparator />
    </template>
    <!-- Add a comment on the player under the right-click -->
    <template v-else-if="contextTarget">
      <ContextMenuItem v-if="contextPlayerId" @select="emit('followPlayer')">
        <UiIcon name="target" class="h-4 w-4 text-ink-400" />
        {{ followSteamId === contextPlayerId ? t('viewer.follow.stop') : t('viewer.follow.start') }}
        <span class="ml-auto max-w-28 truncate pl-3 text-ink-400">
          {{ anchorLabel(contextTarget.anchor) }}
        </span>
      </ContextMenuItem>
      <ContextMenuItem @select="emit('addComment')">
        <UiIcon name="message" class="h-4 w-4 text-ink-400" />
        {{ t('viewer.comment.add') }}
        <span class="ml-auto max-w-28 truncate pl-3 text-ink-400">
          {{ anchorLabel(contextTarget.anchor) }}
        </span>
      </ContextMenuItem>
      <ContextMenuItem @select="emit('copySetpos')">
        <UiIcon name="copy" class="h-4 w-4 text-ink-400" />
        {{ t('viewer.copyPos') }}
      </ContextMenuItem>
      <ContextMenuSeparator />
    </template>
    <ContextMenuItem @select="r.toggle">
      <UiIcon :name="r.playing.value ? 'pause' : 'play'" class="h-4 w-4 text-ink-400" />
      {{ r.playing.value ? t('viewer.pause') : t('viewer.play') }}
      <ContextMenuShortcut>{{ t('viewer.space') }}</ContextMenuShortcut>
    </ContextMenuItem>
    <ContextMenuItem @select="r.seekBySeconds(-5)">
      <UiIcon name="rotate-ccw" class="h-4 w-4 text-ink-400" />
      {{ t('viewer.back5') }}
      <ContextMenuShortcut>&larr;</ContextMenuShortcut>
    </ContextMenuItem>
    <ContextMenuItem @select="r.seekBySeconds(5)">
      <UiIcon name="rotate-cw" class="h-4 w-4 text-ink-400" />
      {{ t('viewer.fwd5') }}
      <ContextMenuShortcut>&rarr;</ContextMenuShortcut>
    </ContextMenuItem>

    <ContextMenuSeparator />

    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <UiIcon name="signal" class="h-4 w-4 text-ink-400" />
        {{ t('viewer.speed') }}
        <span class="ml-auto pl-4 font-mono text-xs text-ink-400">{{ r.speed.value }}x</span>
      </ContextMenuSubTrigger>
      <ContextMenuSubContent>
        <ContextMenuItem v-for="s in SPEEDS" :key="s" inset @select="r.speed.value = s">
          <UiIcon
            v-if="s === r.speed.value"
            name="check"
            class="absolute left-2 h-3.5 w-3.5 text-surge-400"
          />
          {{ s }}x
        </ContextMenuItem>
      </ContextMenuSubContent>
    </ContextMenuSub>

    <ContextMenuSeparator />

    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <UiIcon name="grid" class="h-4 w-4 text-ink-400" />
        {{ t('viewer.rounds') }}
        <span class="ml-auto pl-4 font-mono text-xs text-ink-400">
          {{ r.currentRoundLabel.value }}/{{ r.totalRounds.value }}
        </span>
      </ContextMenuSubTrigger>
      <ContextMenuSubContent class="max-h-80 overflow-y-auto">
        <ContextMenuItem
          v-for="(label, i) in r.roundLabels.value"
          :key="i"
          inset
          @select="r.selectRound(i)"
        >
          <UiIcon
            v-if="i === r.roundIndex.value"
            name="check"
            class="absolute left-2 h-3.5 w-3.5 text-surge-400"
          />
          <span
            class="mr-2 inline-block h-2 w-2 shrink-0 rounded-full"
            :style="{ backgroundColor: roundWinnerColor(i) }"
          />
          <span class="flex-1">{{ label === '0' ? t('viewer.knife') : `${t('viewer.round')} ${label}` }}</span>
          <UiIcon
            v-if="roundOutcomeFor(i)"
            :name="roundOutcomeFor(i)!.icon"
            class="ml-3 h-3.5 w-3.5 text-ink-400"
          />
        </ContextMenuItem>
      </ContextMenuSubContent>
    </ContextMenuSub>
  </ContextMenuContent>
</template>
