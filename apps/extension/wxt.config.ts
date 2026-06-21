import { defineConfig } from 'wxt'
import tailwindcss from '@tailwindcss/vite'

// WXT config. The Faceit overlay is a Vue app mounted in a Shadow DOM (via
// createShadowRootUi) so Tailwind/shadcn-vue styles stay isolated from Faceit's
// page. The framework-free demo pipeline (schema, voice codec, .cs2dv archive)
// is shared from the `@cs2/replay-core` workspace package. What still lives under
// `lib/` is the parser worker shell + the committed WASM artifacts (`parser/`),
// which stay vendored because WXT can't emit `new URL(..., import.meta.url)`;
// keep those in sync when the app's parser changes.
export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  manifest: {
    name: 'CS Demo Analyzer',
    description: 'Open any Faceit CS2 match as a 2D replay in one click. Demos are downloaded and parsed locally, 100% offline.',
    permissions: ['storage', 'offscreen'],
    // Required hosts: the shipping/next sources. Avoids <all_urls> and its review.
    host_permissions: [
      '*://*.faceit.com/*',
      '*://*.faceit-cdn.net/*',
      '*://*.hltv.org/*',
      '*://*.gamersclub.com.br/*',
    ],
    // Later sources, granted at runtime via chrome.permissions.request.
    optional_host_permissions: ['*://*.valve.net/*', '*://*.5eplay.com/*', '*://*.renown.gg/*'],
    // The offscreen document runs the WASM parser; allow wasm in extension pages.
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
    // Map art drawn on the overlay cards (loaded by the content script): 2D
    // `radars/` for the Demo-page hero, `thumbs/` photos for the library list.
    web_accessible_resources: [
      { resources: ['maps/radars/*', 'maps/thumbs/*'], matches: ['*://*.faceit.com/*'] },
    ],
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
})
