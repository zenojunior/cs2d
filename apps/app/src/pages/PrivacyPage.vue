<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '@/app/i18n'

// Static privacy policy. The app runs entirely client-side, so the policy is
// short and honest: nothing is uploaded, no analytics today. Everything visible
// is translatable; the contact email is data rendered as a link.
const { t, locale } = useI18n()

const CONTACT_EMAIL = 'me@zenojunior.com'

// Date the policy was last reviewed; formatted per the active locale.
const LAST_UPDATED = '2026-06-21'
const lastUpdated = computed(() =>
  new Date(`${LAST_UPDATED}T00:00:00`).toLocaleDateString(locale.value, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }),
)

// The contact line carries the email as a `{email}` placeholder so it can be
// rendered as a mailto link; split the body around it (NUL sentinel keeps
// vue-i18n from dropping the placeholder before we split).
const contactParts = computed(() => {
  const [before, after] = t('privacy.contactBody', { email: '\0' }).split('\0')
  return { before, after: after ?? '' }
})

// Body sections, in order. Each maps to a `{title, body}` pair in i18n.
const SECTIONS = ['local', 'storage', 'analytics', 'thirdParty'] as const
</script>

<template>
  <div class="h-full overflow-y-auto bg-ink-950">
    <div class="mx-auto max-w-2xl px-5 py-10 sm:px-6 sm:py-14">
      <h1 class="text-2xl font-semibold text-ink-50 sm:text-3xl">{{ t('privacy.title') }}</h1>
      <p class="mt-3 text-sm leading-relaxed text-ink-300 sm:text-base">{{ t('privacy.tagline') }}</p>
      <p class="mt-2 text-xs text-ink-500">{{ t('privacy.lastUpdated') }}: {{ lastUpdated }}</p>

      <section v-for="key in SECTIONS" :key="key" class="mt-10">
        <h2 class="text-sm font-semibold uppercase tracking-wide text-surge-400">
          {{ t(`privacy.${key}Title`) }}
        </h2>
        <p class="mt-3 text-sm leading-relaxed text-ink-300">{{ t(`privacy.${key}Body`) }}</p>
      </section>

      <!-- Contact -->
      <section class="mt-10">
        <h2 class="text-sm font-semibold uppercase tracking-wide text-surge-400">
          {{ t('privacy.contactTitle') }}
        </h2>
        <p class="mt-3 text-sm leading-relaxed text-ink-300">
          {{ contactParts.before
          }}<a
            :href="`mailto:${CONTACT_EMAIL}`"
            class="font-medium text-ink-100 underline decoration-ink-600 underline-offset-2 transition-colors hover:text-ink-50 hover:decoration-ink-400"
            >{{ CONTACT_EMAIL }}</a
          >{{ contactParts.after }}
        </p>
      </section>
    </div>
  </div>
</template>
