// Only the circle flags for the locales we actually offer. Importing the full
// `circleFlags` map from @blade-flags/core/flags/circle pulls ~480KB (every
// country/language flag) into the main bundle even though we show nine. Naming
// the individual exports lets the bundler tree-shake the rest away.
//
// `<Flag :flags="localeFlags" :code="..." />` resolves `country-${code}`, so the
// keys must stay in that shape (see resolveFlag in @blade-flags/core).
import {
  countryBr,
  countryUs,
  countryEs,
  countryFr,
  countryDe,
  countryRu,
  countryPl,
  countryTr,
  countryUa,
} from '@blade-flags/core/flags/circle'

export const localeFlags: Record<string, string> = {
  'country-br': countryBr,
  'country-us': countryUs,
  'country-es': countryEs,
  'country-fr': countryFr,
  'country-de': countryDe,
  'country-ru': countryRu,
  'country-pl': countryPl,
  'country-tr': countryTr,
  'country-ua': countryUa,
}
