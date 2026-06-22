import { defineContentScript, createShadowRootUi } from '#imports'
import { createApp } from 'vue'
import App from './App.vue'
import RoomButton from './RoomButton.vue'
import { mountHistoryButtons } from './historyButtons'
import '@/assets/tailwind.css'

// Faceit's "Watch demo" / "Assistir à demonstração" control inside the room's
// info box. Matched by text (works across locales: "demo" / "démo" / "демо")
// rather than an obfuscated class. Our own button lives in a shadow root, so it
// can't match itself. Returns null when there's no demo (button won't mount).
function findDemoControl(): HTMLElement | null {
  const candidates = document.querySelectorAll<HTMLElement>(
    'div[name="info"] a, div[name="info"] button, div[name="info"] [role="button"]',
  )
  return Array.from(candidates).find((el) => /demo|démo|демо/i.test(el.textContent || '')) ?? null
}

// Two shadow-root UIs on Faceit, both Vue apps with Tailwind/shadcn-vue isolated
// from the page (and vice-versa):
//  - the floating overlay (the rich panel), anchored to <body>;
//  - the in-page room button, anchored to Faceit's `div[name="info"]` and placed
//    above "Watch demo". autoMount() observes that anchor, so the button mounts
//    when a room opens and unmounts when it goes away (SPA navigation), no manual
//    MutationObserver needed.
export default defineContentScript({
  matches: ['*://*.faceit.com/*'],
  cssInjectionMode: 'ui',
  async main(ctx) {
    const overlay = await createShadowRootUi(ctx, {
      name: 'cs2dv-overlay',
      position: 'inline',
      anchor: 'body',
      onMount(container) {
        const app = createApp(App)
        // Expose the shadow-root container so reka-ui portals (Select dropdown)
        // teleport inside the shadow tree (keeps styles) and escape the panel's
        // own `overflow-hidden`/scroll clipping.
        app.provide('uiRoot', container)
        app.mount(container)
        return app
      },
      onRemove(app) {
        app?.unmount()
      },
    })
    overlay.mount()

    const roomButton = await createShadowRootUi(ctx, {
      name: 'cs2dv-room-button',
      position: 'inline',
      anchor: findDemoControl,
      append: 'before',
      onMount(container) {
        const app = createApp(RoomButton)
        app.provide('uiRoot', container)
        app.mount(container)
        return app
      },
      onRemove(app) {
        app?.unmount()
      },
    })
    roomButton.autoMount()

    // A "2D" button beside each item in the match-history list.
    mountHistoryButtons(ctx)
  },
})
