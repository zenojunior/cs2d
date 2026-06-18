<script setup lang="ts">
import { useRegisterSW } from 'virtual:pwa-register/vue'
import { useI18n } from '@/i18n'

/**
 * Small toast for the service worker lifecycle. `offlineReady` shows once the
 * app shell and assets are cached (it then works without a network); `needRefresh`
 * prompts the user to reload when a new build is available. We use `prompt`
 * registration (not autoUpdate) so an update never reloads mid-analysis.
 */
const { t } = useI18n()
const { offlineReady, needRefresh, updateServiceWorker } = useRegisterSW()

function dismiss() {
  offlineReady.value = false
  needRefresh.value = false
}
</script>

<template>
  <Transition name="pwa-toast">
    <div
      v-if="offlineReady || needRefresh"
      class="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-lg border border-white/10 bg-[#11141d] px-4 py-3 text-sm text-white shadow-lg"
      role="status"
    >
      <span>{{ needRefresh ? t('pwa.updateAvailable') : t('pwa.offlineReady') }}</span>
      <button
        v-if="needRefresh"
        class="rounded-md bg-[#FDAC1A] px-3 py-1 font-medium text-black transition hover:brightness-110"
        @click="updateServiceWorker(true)"
      >
        {{ t('pwa.reload') }}
      </button>
      <button
        class="rounded-md px-2 py-1 text-white/60 transition hover:text-white"
        @click="dismiss"
      >
        {{ t('pwa.dismiss') }}
      </button>
    </div>
  </Transition>
</template>

<style scoped>
.pwa-toast-enter-active,
.pwa-toast-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.pwa-toast-enter-from,
.pwa-toast-leave-to {
  opacity: 0;
  transform: translateY(0.5rem);
}
</style>
