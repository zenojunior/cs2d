import { createI18n, useI18n as useVueI18n } from 'vue-i18n'
import pt from './locales/pt.json'

/**
 * i18n powered by vue-i18n. The fallback locale (pt) is bundled eagerly so a
 * translation is always available; every other locale lives in its own JSON
 * file under ./locales and is fetched on demand the first time it's selected.
 * This keeps the initial bundle small as more languages are added.
 *
 * To add a locale: drop a `<code>.json` under ./locales (same shape as pt.json),
 * add it to LOCALES (with its circle-flag country code) and to LocaleCode.
 */
export type LocaleCode = 'pt' | 'en' | 'es' | 'fr' | 'de' | 'ru' | 'pl' | 'tr' | 'uk'

export const LOCALES: { code: LocaleCode; label: string; name: string; flag: string }[] = [
  { code: 'pt', label: 'PT', name: 'Português', flag: 'br' },
  { code: 'en', label: 'EN', name: 'English', flag: 'us' },
  { code: 'es', label: 'ES', name: 'Español', flag: 'es' },
  { code: 'fr', label: 'FR', name: 'Français', flag: 'fr' },
  { code: 'de', label: 'DE', name: 'Deutsch', flag: 'de' },
  { code: 'ru', label: 'RU', name: 'Русский', flag: 'ru' },
  { code: 'pl', label: 'PL', name: 'Polski', flag: 'pl' },
  { code: 'tr', label: 'TR', name: 'Türkçe', flag: 'tr' },
  { code: 'uk', label: 'UK', name: 'Українська', flag: 'ua' },
]

const STORAGE_KEY = 'demo-viewer-locale'

// The pt catalog defines the message schema every other locale must match.
type MessageSchema = typeof pt

// Lazy loaders for every locale JSON. pt is also imported eagerly above so it
// ships in the main chunk and can always serve as the fallback.
const localeLoaders = import.meta.glob<{ default: MessageSchema }>('./locales/*.json')

function detect(): LocaleCode {
  const saved = localStorage.getItem(STORAGE_KEY) as LocaleCode | null
  if (saved && LOCALES.some((l) => l.code === saved)) return saved
  const nav = navigator.language?.toLowerCase() ?? 'en'
  const match = LOCALES.find((l) => nav.startsWith(l.code))
  return match?.code ?? 'en'
}

export const i18n = createI18n({
  legacy: false,
  globalInjection: true,
  locale: 'pt',
  fallbackLocale: 'pt',
  // Only pt is bundled; the rest are added at runtime via setLocaleMessage. The
  // cast widens the inferred locale set so locale.value accepts every code.
  messages: { pt } as Record<LocaleCode, MessageSchema>,
})

const loaded = new Set<LocaleCode>(['pt'])

async function loadLocaleMessages(code: LocaleCode): Promise<void> {
  if (loaded.has(code)) return
  const loader = localeLoaders[`./locales/${code}.json`]
  if (!loader) return
  const mod = await loader()
  i18n.global.setLocaleMessage(code, mod.default)
  loaded.add(code)
}

export async function setLocale(code: LocaleCode): Promise<void> {
  await loadLocaleMessages(code)
  i18n.global.locale.value = code
  localStorage.setItem(STORAGE_KEY, code)
}

// Switch to the detected locale on startup; awaited in main.ts before mount so
// the app paints in the right language instead of flashing the pt fallback.
export const i18nReady = setLocale(detect())

export function useI18n() {
  const { t, locale } = useVueI18n({ useScope: 'global' })
  return { t, locale, setLocale, LOCALES }
}
