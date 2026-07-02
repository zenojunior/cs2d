import { watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from '@/app/i18n'

// Canonical production origin; used for <link rel=canonical> and og:url.
const SITE_URL = 'https://cs2d.app'
const BRAND = 'CS2d.app'

// Per-route head data keyed by route name. `titleKey` is an i18n key shown
// before the brand; omit it for inner viewer routes (brand only). The home page
// (path '/') instead appends a descriptive tagline (`seo.homeTitle`) after the
// brand so the title makes clear what the app is. `descKey` feeds the meta
// description. Keys resolve through i18n so the head follows the active locale,
// reusing the page strings we already translate.
const ROUTE_SEO: Record<string, { titleKey?: string; descKey: string }> = {
  demoviewer: { descKey: 'seo.appDescription' },
  library: { titleKey: 'shell.library', descKey: 'seo.appDescription' },
  major: { titleKey: 'shell.major', descKey: 'major.intro' },
  about: { titleKey: 'shell.project', descKey: 'about.tagline' },
  privacy: { titleKey: 'shell.privacy', descKey: 'privacy.tagline' },
}

// Set (creating if absent) a <meta> tag's content, matched by `selector` and
// keyed by `attr`/`key` when it has to be created.
function upsertMeta(selector: string, attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(selector)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

function upsertCanonical(href: string) {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (!el) {
    el = document.createElement('link')
    el.rel = 'canonical'
    document.head.appendChild(el)
  }
  el.href = href
}

// Keep <title>, meta description, social tags and canonical in sync with the
// active route and locale. Call once from the app shell. index.html ships
// sensible defaults for crawlers that don't run JS; this layers per-route,
// localized values on top once the SPA is live.
export function useSeoHead() {
  const route = useRoute()
  const { t, locale } = useI18n()

  watch(
    [() => route.name, locale],
    () => {
      const seo = ROUTE_SEO[String(route.name)] ?? ROUTE_SEO.demoviewer
      const title =
        route.path === '/'
          ? `${BRAND} · ${t('seo.homeTitle')}`
          : seo.titleKey
            ? `${t(seo.titleKey)} · ${BRAND}`
            : BRAND
      const description = t(seo.descKey)
      const url = SITE_URL + route.path

      document.title = title
      upsertMeta('meta[name="description"]', 'name', 'description', description)
      upsertMeta('meta[property="og:title"]', 'property', 'og:title', title)
      upsertMeta('meta[property="og:description"]', 'property', 'og:description', description)
      upsertMeta('meta[name="twitter:title"]', 'name', 'twitter:title', title)
      upsertMeta('meta[name="twitter:description"]', 'name', 'twitter:description', description)
      upsertMeta('meta[property="og:url"]', 'property', 'og:url', url)
      upsertCanonical(url)
    },
    { immediate: true },
  )
}
