import { createShadowRootUi, type ContentScriptContext } from '#imports'
import { createApp } from 'vue'
import HistoryButton from './HistoryButton.vue'

// A "2D" button beside each item in Faceit's match-history list ("Partidas"
// panel). Follows sparkoo/csgo-2d-demo-viewer: the list lives in
// #scrollable-match-history and each match is an <a> linking to its room. We
// mount one shadow-root button per item (Tailwind isolated), tracked so the
// list re-rendering / scrolling doesn't double-inject.
const MARK = 'data-cs2dv-2d'

function matchIdFromHref(href: string): string | null {
  return href.match(/\/room\/([\w-]+)/)?.[1] ?? null
}

export function mountHistoryButtons(ctx: ContentScriptContext) {
  let pending = 0

  async function inject() {
    const list = document.getElementById('scrollable-match-history')
    if (!list) return
    const items = list.querySelectorAll<HTMLAnchorElement>('a[href*="/room/"]')
    for (const item of items) {
      if (item.hasAttribute(MARK)) continue
      const matchId = matchIdFromHref(item.getAttribute('href') || '')
      if (!matchId) continue
      // The item's card (the list-item div) holds the match's own button; we want
      // ours as its sibling, sharing the same row, not below the whole <a>.
      const card = item.firstElementChild
      if (!(card instanceof HTMLElement)) continue
      // Mark synchronously so the await below can't race a second pass.
      item.setAttribute(MARK, '')
      const roomUrl = new URL(item.href, location.origin).href
      // Lay the card as a flex row: the match's button grows, ours sits beside it.
      card.style.display = 'flex'
      card.style.alignItems = 'center'
      const holder = card.firstElementChild
      if (holder instanceof HTMLElement) {
        holder.style.flex = '1'
        holder.style.minWidth = '0'
      }
      const ui = await createShadowRootUi(ctx, {
        name: 'cs2dv-history-button',
        position: 'inline',
        anchor: card,
        append: 'last',
        onMount(container) {
          const app = createApp(HistoryButton, { matchId, roomUrl })
          app.provide('uiRoot', container)
          app.mount(container)
          return app
        },
        onRemove(app) {
          app?.unmount()
        },
      })
      ui.mount()
      // Keep the button (shadow host) from shrinking, and give it a little room.
      ui.shadowHost.style.flexShrink = '0'
      ui.shadowHost.style.display = 'flex'
      ui.shadowHost.style.marginRight = '8px'
    }
  }

  // The panel mounts/refreshes via SPA; debounce re-injection on DOM changes.
  const observer = new MutationObserver(() => {
    window.clearTimeout(pending)
    pending = window.setTimeout(() => void inject(), 300)
  })
  observer.observe(document.body, { childList: true, subtree: true })
  void inject()
}
