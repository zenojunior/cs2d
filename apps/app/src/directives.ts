import type { App, Directive, DirectiveBinding } from 'vue'

/**
 * `v-tooltip` directive
 * ---------------------------------------------------------------------------
 * Styled tooltip applicable to ANY element, without a wrapper. Inspired by
 * shadcn-vue/tooltip, but implemented as a native directive (no reka-ui) to keep
 * things light. Features:
 *   - Renders in a single portal on <body>, so it is never clipped by overflow.
 *   - Auto flip: switches side when it does not fit in the viewport.
 *   - Opens on hover and focus (keyboard); closes on Esc.
 *   - Respects prefers-reduced-motion (styles in style.css).
 *
 * Usage:
 *   <button v-tooltip="'Plain text'">...</button>
 *   <button v-tooltip.bottom="'Opens below'">...</button>
 *   <button v-tooltip:right="'Opens to the right'">...</button>
 *   <span v-tooltip="{ content: 'Detailed', side: 'right', delay: 0 }">...</span>
 *
 * Modifiers: `.top` `.bottom` `.left` `.right` set the side; `.now` opens with no
 * delay. The options object takes precedence over them.
 */

type Side = 'top' | 'bottom' | 'left' | 'right'

interface TooltipOptions {
  content: string
  side: Side
  delay: number
  offset: number
}

type TooltipValue =
  | string
  | (Partial<Omit<TooltipOptions, 'content'>> & { content: string })
  | null
  | undefined

const ARROW = 9 // arrow size (px)
const HALF = ARROW / 2
const MARGIN = 8 // minimum gap from the viewport edges
const SIDES: Side[] = ['top', 'bottom', 'left', 'right']
const OPPOSITE: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }

// --- Bubble singleton (reused across all targets) ----------------------------
let tip: HTMLElement | null = null
let labelEl: HTMLElement | null = null
let arrowEl: HTMLElement | null = null

let active: HTMLElement | null = null // target whose tooltip is visible
let openTimer: ReturnType<typeof setTimeout> | null = null

const store = new WeakMap<HTMLElement, TooltipOptions>()

interface Handlers {
  enter: () => void
  leave: () => void
  focus: () => void
  blur: () => void
}
const handlers = new WeakMap<HTMLElement, Handlers>()

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max)

function ensureRoot() {
  if (tip || typeof document === 'undefined') return

  tip = document.createElement('div')
  tip.className = 'dv-tooltip'
  tip.id = 'dv-tooltip'
  tip.setAttribute('role', 'tooltip')
  tip.dataset.show = 'false'

  arrowEl = document.createElement('span')
  arrowEl.className = 'dv-tooltip__arrow'

  labelEl = document.createElement('span')
  labelEl.className = 'dv-tooltip__label'

  tip.append(arrowEl, labelEl)
  document.body.appendChild(tip)

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && active) hide(active)
  })
}

/** Resolves the directive value + modifiers into a complete config. */
function normalize(value: TooltipValue, binding: DirectiveBinding): TooltipOptions | null {
  const raw = typeof value === 'string' ? { content: value } : value
  if (!raw || !raw.content) return null

  const fromModifier = SIDES.find((s) => binding.modifiers[s])
  const side = raw.side || (binding.arg as Side) || fromModifier || 'top'

  return {
    content: raw.content,
    side: SIDES.includes(side) ? side : 'top',
    delay: raw.delay ?? (binding.modifiers.now ? 0 : 150),
    offset: raw.offset ?? 8,
  }
}

/** Positions the bubble (and arrow) in viewport coords, with flip + clamp. */
function place(target: HTMLElement, opts: TooltipOptions) {
  if (!tip || !arrowEl) return

  const r = target.getBoundingClientRect()
  const tw = tip.offsetWidth
  const th = tip.offsetHeight
  const vw = document.documentElement.clientWidth
  const vh = document.documentElement.clientHeight
  const gap = opts.offset + HALF // total offset, including the arrow

  // Pick the first side that fits: preferred, then opposite, then the rest.
  const order = [
    opts.side,
    OPPOSITE[opts.side],
    ...SIDES.filter((s) => s !== opts.side && s !== OPPOSITE[opts.side]),
  ]
  let side = opts.side
  for (const s of order) {
    if (s === 'top' && r.top - th - gap >= MARGIN) { side = s; break }
    if (s === 'bottom' && r.bottom + th + gap <= vh - MARGIN) { side = s; break }
    if (s === 'left' && r.left - tw - gap >= MARGIN) { side = s; break }
    if (s === 'right' && r.right + tw + gap <= vw - MARGIN) { side = s; break }
  }

  // Top-left corner of the bubble
  let left: number
  let top: number
  if (side === 'top' || side === 'bottom') {
    left = r.left + r.width / 2 - tw / 2
    top = side === 'top' ? r.top - th - gap : r.bottom + gap
  } else {
    top = r.top + r.height / 2 - th / 2
    left = side === 'left' ? r.left - tw - gap : r.right + gap
  }

  left = clamp(left, MARGIN, vw - tw - MARGIN)
  top = clamp(top, MARGIN, vh - th - MARGIN)

  tip.style.left = `${Math.round(left)}px`
  tip.style.top = `${Math.round(top)}px`
  tip.dataset.side = side

  // Arrow pointing to the target center, pinned to the bubble edges.
  if (side === 'top' || side === 'bottom') {
    const cx = clamp(r.left + r.width / 2 - left, HALF + MARGIN, tw - HALF - MARGIN)
    arrowEl.style.left = `${Math.round(cx) - HALF}px`
    arrowEl.style.top = side === 'top' ? `${th - HALF}px` : `${-HALF}px`
  } else {
    const cy = clamp(r.top + r.height / 2 - top, HALF + MARGIN, th - HALF - MARGIN)
    arrowEl.style.top = `${Math.round(cy) - HALF}px`
    arrowEl.style.left = side === 'left' ? `${tw - HALF}px` : `${-HALF}px`
  }
}

function reposition() {
  if (active) {
    const o = store.get(active)
    if (o) place(active, o)
  }
}

function show(target: HTMLElement) {
  const opts = store.get(target)
  if (!opts) return
  ensureRoot()
  if (!tip || !labelEl) return

  active = target
  labelEl.textContent = opts.content
  place(target, opts) // measure with content applied, then position
  tip.dataset.show = 'true'
  target.setAttribute('aria-describedby', 'dv-tooltip')

  window.addEventListener('scroll', reposition, true)
  window.addEventListener('resize', reposition)
}

function hide(target: HTMLElement) {
  if (active !== target) return
  if (tip) tip.dataset.show = 'false'
  target.removeAttribute('aria-describedby')
  active = null
  window.removeEventListener('scroll', reposition, true)
  window.removeEventListener('resize', reposition)
}

function clearOpen() {
  if (openTimer) {
    clearTimeout(openTimer)
    openTimer = null
  }
}

function open(target: HTMLElement) {
  const opts = store.get(target)
  if (!opts) return
  clearOpen()
  if (active && active !== target) hide(active) // direct swap, no intermediate fade
  if (opts.delay > 0) openTimer = setTimeout(() => show(target), opts.delay)
  else show(target)
}

function close(target: HTMLElement) {
  clearOpen()
  hide(target)
}

function attach(el: HTMLElement) {
  const h: Handlers = {
    enter: () => open(el),
    leave: () => close(el),
    focus: () => show(el), // keyboard focus opens immediately
    blur: () => close(el),
  }
  el.addEventListener('mouseenter', h.enter)
  el.addEventListener('mouseleave', h.leave)
  el.addEventListener('focus', h.focus)
  el.addEventListener('blur', h.blur)
  handlers.set(el, h)
}

function detach(el: HTMLElement) {
  const h = handlers.get(el)
  if (!h) return
  el.removeEventListener('mouseenter', h.enter)
  el.removeEventListener('mouseleave', h.leave)
  el.removeEventListener('focus', h.focus)
  el.removeEventListener('blur', h.blur)
  handlers.delete(el)
}

export const vTooltip: Directive<HTMLElement, TooltipValue> = {
  mounted(el, binding) {
    const opts = normalize(binding.value, binding)
    if (!opts) return
    store.set(el, opts)
    attach(el)
  },
  updated(el, binding) {
    const opts = normalize(binding.value, binding)
    if (!opts) {
      close(el)
      detach(el)
      store.delete(el)
      return
    }
    const wasAttached = handlers.has(el)
    store.set(el, opts)
    if (!wasAttached) attach(el)
    if (active === el && labelEl) {
      labelEl.textContent = opts.content
      place(el, opts)
    }
  },
  beforeUnmount(el) {
    close(el)
    detach(el)
    store.delete(el)
  },
}

// Enables type checking of v-tooltip in templates.
declare module 'vue' {
  interface GlobalDirectives {
    vTooltip: typeof vTooltip
  }
}

/** Registers the app global directives. */
export function registerDirectives(app: App) {
  app.directive('tooltip', vTooltip)
}
