import { ref } from 'vue'

// Shared collapse state for the primary sidebar. Lives at module scope (singleton,
// like the other composables) so the sidebar itself and the top-bar toggle button
// read and flip the exact same value. The preference is remembered across sessions.
const STORAGE_KEY = 'cs2dv:sidebar-collapsed'

function readInitial(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

const collapsed = ref(readInitial())

function toggle() {
  collapsed.value = !collapsed.value
  try {
    localStorage.setItem(STORAGE_KEY, collapsed.value ? '1' : '0')
  } catch {
    // Storage unavailable: the preference just won't persist.
  }
}

// Mobile drawer state. On narrow viewports the sidebar is off-canvas and opens
// as an overlay on top of the content instead of pushing it. Not persisted:
// every visit starts closed.
const mobileOpen = ref(false)

function openMobile() {
  mobileOpen.value = true
}

function closeMobile() {
  mobileOpen.value = false
}

function toggleMobile() {
  mobileOpen.value = !mobileOpen.value
}

export function useSidebar() {
  return { collapsed, toggle, mobileOpen, openMobile, closeMobile, toggleMobile }
}
