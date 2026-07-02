// Keyboard shortcuts for the replay stage: space toggles play/pause, arrows seek
// +/-5s, Ctrl/Cmd+Z / +Y drive the coach board's undo/redo, Tab holds the
// scoreboard open, and Escape drops the followed player. Split out of ViewerStage
// so the component isn't cluttered with input plumbing; it owns `scoreboardOpen`.
import { ref, type Ref } from 'vue'
import { onKeyStroke, useEventListener } from '@vueuse/core'

const TEXT_INPUT_TYPES = ['text', 'search', 'email', 'url', 'tel', 'password', 'number']

function isTyping(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null
  if (!el) return false
  if (el.isContentEditable || el.tagName === 'TEXTAREA') return true
  return el.tagName === 'INPUT' && TEXT_INPUT_TYPES.includes((el as HTMLInputElement).type)
}

interface ViewerShortcutsOptions {
  /** Whether the stage is the visible tab (shortcuts stand down when false). */
  active: () => boolean | undefined
  coachMode: Ref<boolean>
  followSteamId: Ref<string | null>
  /** Toggle play/pause. */
  toggle: () => void
  /** Seek by a signed number of seconds within the round. */
  seek: (seconds: number) => void
  /** Coach board undo/redo. */
  undo: () => void
  redo: () => void
}

export function useViewerShortcuts(opts: ViewerShortcutsOptions) {
  /** Shortcuts are inert while the stage isn't the active tab (it stays mounted
   *  via v-show on other tabs) or while typing in a field. */
  function shortcutsBlocked(e: KeyboardEvent) {
    return opts.active() === false || isTyping(e)
  }

  // Playback shortcuts are disabled in coach mode: the board is frozen on the tick
  // the coach entered, so play/pause and seeking would break it.
  onKeyStroke(' ', (e) => {
    if (shortcutsBlocked(e) || opts.coachMode.value) return
    e.preventDefault()
    opts.toggle()
  })
  onKeyStroke('ArrowRight', (e) => {
    if (shortcutsBlocked(e) || opts.coachMode.value) return
    e.preventDefault()
    opts.seek(5)
  })
  onKeyStroke('ArrowLeft', (e) => {
    if (shortcutsBlocked(e) || opts.coachMode.value) return
    e.preventDefault()
    opts.seek(-5)
  })

  // Undo/redo on the tactical board (coach mode only). Ctrl/Cmd+Z undoes,
  // Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y redoes.
  onKeyStroke(['z', 'Z'], (e) => {
    if (!opts.coachMode.value || shortcutsBlocked(e) || !(e.ctrlKey || e.metaKey)) return
    e.preventDefault()
    if (e.shiftKey) opts.redo()
    else opts.undo()
  })
  onKeyStroke(['y', 'Y'], (e) => {
    if (!opts.coachMode.value || shortcutsBlocked(e) || !(e.ctrlKey || e.metaKey)) return
    e.preventDefault()
    opts.redo()
  })

  // Scoreboard (TAB style): shown while the key is held.
  const scoreboardOpen = ref(false)
  onKeyStroke(
    'Tab',
    (e) => {
      if (shortcutsBlocked(e)) return
      e.preventDefault()
      scoreboardOpen.value = true
    },
    { eventName: 'keydown' },
  )
  onKeyStroke(
    'Tab',
    (e) => {
      if (opts.active() === false) return
      e.preventDefault()
      scoreboardOpen.value = false
    },
    { eventName: 'keyup' },
  )
  // Lost focus (e.g. alt-tab) with TAB held: make sure the scoreboard closes.
  useEventListener(window, 'blur', () => (scoreboardOpen.value = false))

  // Esc stops following the current player.
  onKeyStroke('Escape', (e) => {
    if (shortcutsBlocked(e) || !opts.followSteamId.value) return
    e.preventDefault()
    opts.followSteamId.value = null
  })

  return { scoreboardOpen }
}
