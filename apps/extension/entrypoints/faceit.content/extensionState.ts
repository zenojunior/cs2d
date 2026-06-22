import { ref } from 'vue'
import { getState } from '@/utils/faceitDownload'
import type { StateReply } from '@/utils/protocol'

// One shared poll of the background state, consumed by every in-page button (the
// room button and each match-history "2D" button), so the page runs a single
// timer instead of one per button. The first consumer starts the poll; it then
// runs for the page's lifetime (cheap: small JSON once a second).
const state = ref<StateReply>({ active: [], stored: [], totalBytes: 0 })
let started = false

async function poll(): Promise<void> {
  try {
    state.value = await getState()
  } catch {
    /* background asleep between sends; next tick retries */
  }
}

export function useExtensionState() {
  if (!started) {
    started = true
    void poll()
    window.setInterval(poll, 1000)
  }
  return state
}

/** Force an immediate refresh (e.g. right after enqueueing a job). */
export function refreshExtensionState(): Promise<void> {
  return poll()
}
